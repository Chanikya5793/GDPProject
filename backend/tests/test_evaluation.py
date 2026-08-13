import json
from pathlib import Path

from evals.run_eval import evaluate


def test_versioned_golden_contract_metrics_and_isolation():
    path = Path(__file__).parents[1] / "evals" / "golden_v1.json"
    metrics = evaluate(json.loads(path.read_text()))
    assert metrics["query_count"] >= 30
    assert metrics["hit_at_1"] >= 0.95
    assert metrics["hit_at_3"] >= 0.98
    assert metrics["hit_at_5"] == 1.0
    assert metrics["mrr"] >= 0.95
    assert metrics["citation_validity"] == 1.0
    assert metrics["abstention_accuracy"] >= 0.95
    assert metrics["action_proposal_validity"] == 1.0
    assert metrics["cross_user_leakage_count"] == 0
