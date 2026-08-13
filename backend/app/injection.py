from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List


INJECTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"ignore\s+(all\s+)?(previous|prior|system)\s+instructions",
        r"(reveal|print|show)\s+(the\s+)?(system|developer)\s+prompt",
        r"you\s+are\s+now\s+",
        r"<\s*/?\s*(system|assistant|tool|developer)\b",
        r"BEGIN\s+(SYSTEM|INSTRUCTIONS|PROMPT)",
        r"call\s+(this\s+)?tool",
        r"exfiltrat(e|ion)|send\s+.*\s+to\s+https?://",
    )
]


@dataclass(frozen=True)
class InjectionAssessment:
    suspicious: bool
    matched_rules: List[str]


def assess_untrusted_text(text: str) -> InjectionAssessment:
    matched = [pattern.pattern for pattern in INJECTION_PATTERNS if pattern.search(text)]
    return InjectionAssessment(suspicious=bool(matched), matched_rules=matched)


def safe_excerpt(text: str, limit: int = 240) -> str:
    normalized = " ".join(text.split())
    return normalized[:limit] + ("…" if len(normalized) > limit else "")


def any_suspicious(texts: Iterable[str]) -> bool:
    return any(assess_untrusted_text(text).suspicious for text in texts)

