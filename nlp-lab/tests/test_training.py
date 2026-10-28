from nlplab.models import create_training_job, predict, train
from nlplab.schemas import AnalyzeRequest, Configuration
from nlplab.store import Store
from nlplab.pipeline import analyze
from nlplab.api import create_app
from fastapi.testclient import TestClient


def test_real_training_evaluation_and_rollback(tmp_path):
    store=Store(tmp_path)
    app=create_app(tmp_path)
    with TestClient(app) as client:
        initial=client.post("/api/analyze",json={"text":"Create a task called Review integration example tomorrow at 3pm","reference_datetime":"2026-10-27T12:00:00-05:00","configuration":{"mode":"rules"}}).json()
        correction=client.post("/api/examples/review",json={"run_id":initial["id"],"operation":"create","entity_type":"task","fields":initial["command"]["fields"],"expected_status":"ready"})
        assert correction.status_code==201
    job=create_training_job(store,"Integration baseline")
    train(store,job["id"])
    trained=store.get("models",job["id"])
    assert trained["status"]=="completed",trained.get("error")
    assert store.setting("active_model") is None
    assert set(trained["evaluation"])=={"validation","test"}
    assert len(trained["evaluation"]["test"])==7
    assert trained["acceptance_curve"]
    assert trained["training_count"]==601
    assert any(row.get("human_reviewed") for row in trained["corpus_snapshot"])
    with TestClient(app) as client:
        activated=client.post(f"/api/models/{job['id']}/activate",json={})
        assert activated.status_code==200
    result=analyze(store,AnalyzeRequest(text="Create a task called Chemistry report tomorrow at 3pm",reference_datetime="2026-10-27T12:00:00-05:00"))
    assert result["classification"]["features"]
    assert len(result["classification"]["classifiers"])==3
    assert result["versions"]["model"]==job["id"]
    # Failed retraining must leave the active artifact untouched.
    bad= create_training_job(store,"Insufficient independent data")
    row=store.get("models",bad["id"])
    row["examples_snapshot"]=row["examples_snapshot"][:2]
    store.put("models",bad["id"],row)
    train(store,bad["id"])
    assert store.get("models",bad["id"])["status"]=="failed"
    assert store.setting("active_model")==job["id"]
    # A historical model remains usable after switching versions.
    assert predict(store,job["id"],"Create a task called Homework","logistic")
