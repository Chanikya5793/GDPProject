import importlib.util
import sys
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nlplab.api import create_app
from nlplab.pipeline import analyze
from nlplab.schemas import AnalyzeRequest, Configuration
from nlplab.seed import seed_examples
from nlplab.store import Store


@pytest.fixture
def store(tmp_path): return Store(tmp_path)


def parse(store,text,**kwargs):
    return analyze(store,AnalyzeRequest(text=text,reference_datetime="2026-10-27T12:00:00-05:00",configuration=Configuration(mode="rules"),**kwargs))


@pytest.mark.parametrize("entity",["task","reminder","note"])
@pytest.mark.parametrize("operation",["create","find","update","delete","complete","reschedule"])
def test_action_type_matrix(store,entity,operation):
    inputs={"create":f"Create a {entity} called Chemistry report tomorrow at 3pm" if entity!="note" else "Create a note called Chemistry report: Keep original words.","find":f"Find the {entity} Chemistry report","update":f"Rename the {entity} Chemistry report to Revised report","delete":f"Delete the {entity} Chemistry report","complete":f"Complete the {entity} Chemistry report","reschedule":f"Move the {entity} Chemistry report to tomorrow at 4pm"}
    result=parse(store,inputs[operation])
    if entity=="note" and operation in ("complete","reschedule"):
        assert result["status"]=="unsupported"
        return
    assert result["status"]=="ready",result["reasons"]
    assert result["command"]["operation"]==operation
    assert result["command"]["entity_type"]==entity
    if operation not in ("create","find","delete"):
        content=result["payload"]["body"]["content"]
        assert result["payload"]["body"]["expected_revision"]==3
        if entity=="task": assert content["estimated_minutes"]==45 and content["category"]=="Study"
        if entity=="note": assert content["body"]=="Original note content" and content["tag_ids"]==["study"]
    assert len(result["stages"])==9


@pytest.mark.parametrize("text,reason",[
    ("Don't delete the task Pay rent","negation"),
    ("Do not complete the reminder Pay rent","negation"),
    ("Create a task called Homework and delete the note Chemistry report","Multiple actions"),
    ("Create a reminder called Homework","requires a date"),
    ("Move my task Chemistry report","requires a new date"),
    ("Create a task called Homework tomorrow at 3","AM/PM"),
    ("Create a task called Homework on 03/04","ambiguous"),
    ("Create a task called Homework on 2026-02-30","Could not resolve"),
    ("Create a task called Homework tomorrow and Friday","Multiple date"),
    ("Delete the task Unknown record","target record"),
    ("Update the task Chemistry report","Specify the field"),
])
def test_blockers(store,text,reason):
    result=parse(store,text)
    assert result["status"]!="ready"
    assert result["payload"] is None
    assert any(reason in item for item in result["reasons"]),result["reasons"]


def test_quoted_note_content_is_data(store):
    result=parse(store,'Create a note called Meeting notes: "Do not delete backups and create a task tomorrow at 3pm."')
    assert result["status"]=="ready",result["reasons"]
    assert result["command"]["fields"]["body"]=="Do not delete backups and create a task tomorrow at 3pm."
    assert "due_date" not in result["command"]["fields"]


def test_normalization_span_mapping(store):
    text="pls   cretae a task called Chemistry report tmrw at 3pm"
    result=parse(store,text)
    assert result["status"]=="ready",result["reasons"]
    assert result["command"]["fields"]["due_date"]=="2026-10-28"
    for stage in result["stages"][5:7]:
        for evidence in stage["evidence"]:
            assert evidence["text"]==text[evidence["start"]:evidence["end"]]
    assert any(e["text"]=="tmrw" for e in result["stages"][6]["evidence"])


def test_reschedule_preserves_unspecified_time(store):
    result=parse(store,"Move the task Chemistry report to tomorrow")
    assert result["status"]=="ready",result["reasons"]
    assert result["payload"]["body"]["content"]["due_time"]=="15:00"


def test_manual_target_selection(store):
    result=parse(store,"Delete my task chemistry",selected_record_id="task-1")
    assert result["status"]=="ready"
    wrong=parse(store,"Delete my task chemistry",selected_record_id="note-1")
    assert wrong["status"]!="ready"


def test_find_filters_and_results(store):
    result=parse(store,"Find my open tasks on 2026-10-30")
    assert result["status"]=="ready",result["reasons"]
    assert result["payload"]["method"]=="GET"
    assert len(result["find_results"])==5
    assert result["payload"]["path"]=="/v1/records/task"


def test_nltk_real_annotations(store):
    result=parse(store,"Create a task called Chemistry report")
    tokens=result["stages"][2]["output"]["tokens"]
    assert tokens
    if tokens[0]["pos"]:
        assert tokens[0]["lemma"]=="create"


def test_corpus_integrity():
    rows=seed_examples()
    assert len(rows)==800
    assert len({(r["operation"],r["entity_type"]) for r in rows if r["expected_status"]=="ready"})==16
    families,texts={},{}
    for row in rows:
        assert row["origin"]=="synthetic-template" and not row["human_reviewed"]
        for table,key in ((families,row["family"]),(texts,row["text"].lower())):
            assert key not in table or table[key]==row["split"]
            table[key]=row["split"]


def test_planner_contract_snapshot_matches_source():
    from nlplab import planner_contract_v1 as snapshot
    source_path=Path(__file__).resolve().parents[2]/"backend/app/models.py"
    if not source_path.exists(): pytest.skip("Companion installed outside Planner checkout")
    spec=importlib.util.spec_from_file_location("planner_source_contract",source_path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    for name in ("TaskContent","ReminderContent","NoteContent","RecordUpsertRequest","RecordDeleteRequest","PlannerRecord"):
        assert getattr(snapshot,name).model_json_schema()==getattr(module,name).model_json_schema(),f"Refresh contract snapshot: {name} drifted"


def test_api_review_export_and_config_lifecycle(tmp_path):
    app=create_app(tmp_path)
    with TestClient(app) as client:
        request={"text":"Create a task called Chemistry report tomorrow at 3pm","reference_datetime":"2026-10-27T12:00:00-05:00"}
        response=client.post("/api/analyze",json=request)
        assert response.status_code==200,response.text
        run=response.json()
        first=client.post(f"/api/runs/{run['id']}/export",json={}).json()
        second=client.post(f"/api/runs/{run['id']}/export",json={}).json()
        assert first==second
        assert first["planner_request"]["body"]["idempotency_key"].startswith("nlplab-")
        assert "preview-record" not in first["planner_request"]["path"]
        correction={"run_id":run["id"],"operation":"create","entity_type":"task","fields":run["command"]["fields"],"expected_status":"ready"}
        saved=client.post("/api/examples/review",json=correction)
        assert saved.status_code==201,saved.text
        example=app.state.store.get("examples",saved.json()["id"])
        assert example["original_prediction"]["id"]==run["id"]
        config=client.post("/api/configurations",json={"name":"Rules baseline","mode":"rules"}).json()
        assert client.get("/api/configurations").json()["active_id"]!=config["id"]
        assert client.post(f"/api/configurations/{config['id']}/activate",json={}).status_code==200
        assert client.get("/api/configurations").json()["active_id"]==config["id"]
        bad=client.post("/api/configurations",json={"rules":[{"id":"bad","kind":"operation","phrase":"trash","value":"hack"}]})
        assert bad.status_code==422
        blocked=client.post("/api/analyze",json={**request,"text":"Don't delete the task Pay rent"}).json()
        assert client.post(f"/api/runs/{blocked['id']}/export",json={}).status_code==409
        naive=client.post("/api/analyze",json={**request,"reference_datetime":"2026-10-27T12:00:00"})
        assert naive.status_code==422
        assert client.post("/api/analyze",json={**request,"timezone":"Invalid/Zone"}).status_code==422


def test_snapshot_validation(tmp_path):
    app=create_app(tmp_path)
    with TestClient(app) as client:
        rows=app.state.store.get("datasets","sample")["records"]
        response=client.post("/api/datasets/import",json={"name":"Imported","records":rows})
        assert response.status_code==201 and response.json()["count"]==15
        assert client.post("/api/datasets/import",json={"name":"Invalid","records":[rows[0],rows[0]]}).status_code==422


def test_failed_model_cannot_activate(tmp_path):
    app=create_app(tmp_path)
    store=app.state.store
    store.set_setting("active_model","previous")
    store.put("models","failed",{"id":"failed","status":"failed","phase":"failed"})
    with TestClient(app) as client:
        assert client.post("/api/models/failed/activate",json={}).status_code==409
        assert store.setting("active_model")=="previous"


@pytest.mark.parametrize("text",[
    "Create a task called A, delete the note Chemistry report",
    "Create a task called A tomorrow at 15:00 and delete the note Chemistry report",
    "Create a task called A and a reminder called B tomorrow",
])
def test_additional_compound_forms(store,text):
    assert parse(store,text)["status"]!="ready"


def test_custom_rule_participates_in_extraction(store):
    config=Configuration(mode="rules",rules=[{"id":"trash","kind":"operation","phrase":"trash","value":"delete"}])
    result=analyze(store,AnalyzeRequest(text="Trash the task Chemistry report",reference_datetime="2026-10-27T12:00:00-05:00",configuration=config))
    assert result["status"]=="ready",result["reasons"]
    assert result["command"]["record_id"]=="task-1"


def test_remind_me_and_content_preservation(store):
    result=parse(store,"Remind me to pay rent tomorrow at 8am")
    assert result["status"]=="ready",result["reasons"]
    assert result["command"]["fields"]["title"]=="pay rent"
    name=parse(store,'Create a task called "cretae"')
    assert name["command"]["fields"]["title"]=="cretae"


def test_delete_negation_after_colon_is_not_note_content(store):
    result=parse(store,"Delete the task Pay rent: actually do not delete it")
    assert result["status"]!="ready"
    assert any("negation" in reason for reason in result["reasons"])


@pytest.mark.parametrize("word,key,count",[("before","due_before",0),("after","due_after",0),("by","due_on_or_before",5)])
def test_find_date_relations(store,word,key,count):
    result=parse(store,f"Find tasks {word} 2026-10-30")
    assert result["status"]=="ready",result["reasons"]
    assert result["command"]["filters"]=={key:"2026-10-30"}
    assert len(result["find_results"])==count
