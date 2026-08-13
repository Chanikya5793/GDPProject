"""Deterministic offline contract evaluation for retrieval and action safety.

The production adapter uses Vertex AI embeddings. This evaluator intentionally has no
cloud dependency: it tests metric calculation, UID partitioning, citations, abstention,
and typed-action extraction against a versioned corpus. Live Vertex evaluation uses the
same schema and should replace ``retrieve`` with production predictions in CI/CD.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent
TOKEN = re.compile(r"[a-z0-9]+")
STOP = {
    "a", "about", "and", "are", "at", "be", "did", "do", "from", "have", "i", "in",
    "is", "it", "my", "on", "the", "to", "what", "when", "which", "who", "will",
}


def tokens(value: str) -> Counter[str]:
    return Counter(token for token in TOKEN.findall(value.lower()) if token not in STOP)


def retrieve(query: str, uid: str, records: list[dict[str, Any]], limit: int = 5):
    query_tokens = tokens(query)
    ranked = []
    for record in records:
        if record["uid"] != uid:
            continue
        document_tokens = tokens(f'{record["title"]} {record["text"]}')
        overlap = sum(min(count, document_tokens[token]) for token, count in query_tokens.items())
        if overlap < 2:
            continue
        score = overlap / math.sqrt(sum(query_tokens.values()) * sum(document_tokens.values()))
        ranked.append((score, record["record_id"], record))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in ranked[:limit]]


def action_for(query: str, retrieved: list[dict[str, Any]]):
    if not retrieved:
        return None
    lowered = query.lower()
    operation = next(
        (name for name in ("reschedule", "complete", "delete") if lowered.startswith(name)), None
    )
    if not operation:
        return None
    target = retrieved[0]
    action = {
        "operation": operation,
        "entity_type": target["entity_type"],
        "record_id": target["record_id"],
    }
    if operation == "reschedule":
        match = re.search(r"to (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2})", lowered)
        if not match:
            return None
        action.update({"due_date": match.group(1), "due_time": match.group(2)})
    return action


def evaluate(dataset: dict[str, Any]) -> dict[str, Any]:
    hits = {1: 0, 3: 0, 5: 0}
    reciprocal_rank = 0.0
    answerable = 0
    abstention_correct = 0
    citation_valid = 0
    citation_total = 0
    action_valid = 0
    action_total = 0
    leakage = 0
    failures = []
    by_id = {record["record_id"]: record for record in dataset["records"]}

    for item in dataset["queries"]:
        ranked = retrieve(item["query"], item["uid"], dataset["records"])
        ids = [record["record_id"] for record in ranked]
        expected = item["expected"]
        abstained = not ranked
        if item.get("should_abstain", False) == abstained:
            abstention_correct += 1
        if expected:
            answerable += 1
            ranks = [ids.index(record_id) + 1 for record_id in expected if record_id in ids]
            if ranks:
                best = min(ranks)
                reciprocal_rank += 1 / best
                for k in hits:
                    hits[k] += int(best <= k)
            else:
                failures.append({"id": item["id"], "reason": "miss", "retrieved": ids})
        for record in ranked:
            citation_total += 1
            valid = by_id.get(record["record_id"]) == record and record["uid"] == item["uid"]
            citation_valid += int(valid)
            leakage += int(record["uid"] != item["uid"])
        if "expected_action" in item:
            action_total += 1
            predicted = action_for(item["query"], ranked)
            action_valid += int(predicted == item["expected_action"])
            if predicted != item["expected_action"]:
                failures.append({"id": item["id"], "reason": "invalid_action", "actual": predicted})

    count = len(dataset["queries"])
    return {
        "dataset_version": dataset["version"],
        "query_count": count,
        "answerable_query_count": answerable,
        "hit_at_1": round(hits[1] / answerable, 4),
        "hit_at_3": round(hits[3] / answerable, 4),
        "hit_at_5": round(hits[5] / answerable, 4),
        "mrr": round(reciprocal_rank / answerable, 4),
        "citation_validity": round(citation_valid / citation_total, 4),
        "abstention_accuracy": round(abstention_correct / count, 4),
        "action_proposal_validity": round(action_valid / action_total, 4),
        "cross_user_leakage_count": leakage,
        "cross_user_leakage_rate": round(leakage / citation_total, 4),
        "failures": failures,
        "evaluation_mode": "offline deterministic contract; production Vertex run not executed",
    }


if __name__ == "__main__":
    source = json.loads((ROOT / "golden_v1.json").read_text())
    print(json.dumps(evaluate(source), indent=2, sort_keys=True))
