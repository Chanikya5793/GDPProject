import difflib
import re
from pathlib import Path

import nltk
from nltk import RegexpParser
from nltk.stem import WordNetLemmatizer
from nltk.tokenize import TreebankWordTokenizer

RESOURCE_DIR = Path(__file__).resolve().parents[1] / "nltk_data"
nltk.data.path.insert(0, str(RESOURCE_DIR))

OPERATIONS = {
    "create": ["create", "add", "make", "i need", "remind me", "note that", "take a note"],
    "find": ["find", "show", "search", "look up", "locate", "list"],
    "update": ["update", "rename", "change", "edit", "set"],
    "delete": ["delete", "remove", "erase", "discard"],
    "complete": ["complete", "finish", "mark", "check off"],
    "reschedule": ["reschedule", "move", "postpone", "shift"],
}
ENTITIES = {"task": ["task", "tasks", "todo", "to-do"], "reminder": ["reminder", "reminders", "remind me"], "note": ["note", "notes", "note that"]}
ABBREVIATIONS = {"tmrw": "tomorrow", "tmr": "tomorrow", "pls": "please", "plz": "please"}
KNOWN_TYPOS = {"cretae": "create", "delte": "delete", "reshedule": "reschedule", "remidner": "reminder", "remaind": "remind"}


def phrase_matches(text, phrase):
    return list(re.finditer(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", text, re.I))


def quoted_ranges(text):
    return [(m.start(), m.end()) for m in re.finditer(r'"[^"\n]*"|“[^”\n]*”|\x27[^\x27\n]+\x27', text)]


def mask_quotes(text):
    chars = list(text)
    for start, end in quoted_ranges(text):
        chars[start:end] = " " * (end - start)
    return "".join(chars)


def normalize(text, config):
    # Map every normalized character back to an original character, including
    # expanded words. Extraction and UI highlighting always use original spans.
    mapping, chars, edits, suggestions = [], [], [], []
    abbreviation_map = {**ABBREVIATIONS, **{r.phrase: r.value for r in config.rules if r.kind == "abbreviation"}}
    quoted = quoted_ranges(text)
    command_seen = False
    command_words = {word for phrases in OPERATIONS.values() for phrase in phrases for word in phrase.split()}
    for match in re.finditer(r"\s+|[\w-]+|[^\w\s]", text, re.UNICODE):
        token = match.group()
        protected = any(a <= match.start() < b for a, b in quoted)
        # Only known command errors near the beginning are expanded. Names and
        # quoted content are never fed through a general spell checker.
        replacement = token
        if token.isspace():
            replacement = " "
        elif token in ("’", "‘"):
            replacement = "'"
        elif not protected:
            replacement = abbreviation_map.get(token.lower(), token)
            if match.start() < 45 and token.lower() in KNOWN_TYPOS and not command_seen:
                replacement = KNOWN_TYPOS[token.lower()]
                suggestions.append({"original": token, "suggestion": replacement, "start": match.start(), "end": match.end(), "applied_to_analysis_only": True})
            if replacement.lower() in command_words:
                command_seen = True
        if replacement != token:
            edits.append({"start": match.start(), "end": match.end(), "before": token, "after": replacement})
        chars.extend(replacement)
        mapping.extend([min(match.start() + i, match.end()-1) for i in range(len(replacement))])
    return "".join(chars), mapping, edits, suggestions


def annotations(text):
    tokenizer = TreebankWordTokenizer()
    spans = list(tokenizer.span_tokenize(text))
    words = [text[a:b] for a, b in spans]
    warnings = []
    try:
        tags = nltk.pos_tag(words)
        lemma = WordNetLemmatizer()
        tokens = [{"text": word, "start": a, "end": b, "pos": tag, "lemma": lemma.lemmatize(word.lower(), {"J": "a", "V": "v", "N": "n", "R": "r"}.get(tag[0], "n"))} for ((word, tag), (a, b)) in zip(tags, spans)]
        tree = RegexpParser("NP: {<DT|PRP\\$>?<JJ.*>*<NN.*>+}\nVP: {<VB.*><RP>?}").parse(tags)
        chunks, offset = [], 0
        for child in tree:
            if isinstance(child, nltk.Tree):
                length = len(child.leaves())
                chunks.append({"label": child.label(), "start": spans[offset][0], "end": spans[offset+length-1][1], "text": text[spans[offset][0]:spans[offset+length-1][1]]})
                offset += length
            else:
                offset += 1
    except LookupError:
        tokens = [{"text": word, "start": a, "end": b, "pos": None, "lemma": None} for word, (a, b) in zip(words, spans)]
        chunks = []
        warnings.append("NLTK resources unavailable: tokenization is active; POS, lemmatization and chunking are skipped. Run python -m nlplab.cli setup-nltk.")
    return tokens, chunks, warnings


def classify_rules(text, config):
    unquoted = mask_quotes(text)
    operations, entities, evidence = [], [], []
    for kind, table in (("operation", OPERATIONS), ("entity", ENTITIES)):
        matches = []
        for value, phrases in table.items():
            for phrase in phrases:
                for match in phrase_matches(unquoted, phrase):
                    matches.append((match.start(), match.end(), value, f"builtin-{kind}-{value}", match.group()))
        for rule in config.rules:
            if rule.kind == kind:
                matches += [(m.start(), m.end(), rule.value, rule.id, m.group()) for m in phrase_matches(unquoted, rule.phrase)]
        matches.sort(key=lambda m: (m[0], -(m[1]-m[0])))
        for start, end, value, rule, phrase in matches:
            evidence.append({"kind": kind, "value": value, "rule_id": rule, "start": start, "end": end, "text": phrase})
        values = [m[2] for m in matches]
        if kind == "operation":
            operations = values
        else:
            entities = values
    return (operations[0] if operations else "unsupported"), (entities[0] if entities else None), evidence


def guards(text, operation, entity):
    command_text = mask_quotes(text)
    # A colon separates note/body data from commands. Guarding data as if it
    # were a command would reject a note saying "don't delete backups".
    head = re.split(r"(?<!\d):", command_text, maxsplit=1)[0] if operation in ("create","update") else command_text
    reasons, unsupported = [], False
    if re.search(r"\b(?:do\s+not|don't|dont|never|not)\b", head, re.I):
        reasons.append("Explicit negation: confirm the intended action in a new request.")
    verbs = "|".join(re.escape(p) for phrases in OPERATIONS.values() for p in phrases)
    if re.search(r"(?:\b(?:and|then|also)\s+(?:(?:then|also|please)\s+)?|[;,]\s*|\.\s+|\n\s*)(?:" + verbs + r")\b", head, re.I) or re.search(r"\band\s+(?:(?:a|an|the|my)\s+)?(?:task|reminder|note)\b",head,re.I):
        reasons.append("Multiple actions detected. Submit one action per request.")
    if re.search(r"\b(?:daily|weekly|monthly|every\s+(?:day|week|month)|repeat|recurring)\b", head, re.I):
        reasons.append("Recurring schedules are outside this version.")
        unsupported = True
    if entity == "note" and operation in ("complete", "reschedule"):
        reasons.append("Notes cannot be completed or rescheduled.")
        unsupported = True
    return reasons, unsupported
