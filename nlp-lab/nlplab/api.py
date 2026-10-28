import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .models import create_training_job, train
from .pipeline import analyze, build_payload
from .planner_contract_v1 import PlannerRecord
from .schemas import AnalyzeRequest, Command, Configuration, Correction, SnapshotImport, TrainRequest
from .store import Store, digest, now, uid


def public_model(row):
    return {key:value for key,value in row.items() if key not in ("examples_snapshot","corpus_snapshot")}


def create_app(root=None):
    store=Store(root or os.getenv("NLPLAB_DATA_DIR",str(Path(__file__).resolve().parents[1]/".lab-data")))

    @asynccontextmanager
    async def lifespan(app):
        for job in store.all("models"):
            if job["status"] in ("pending","running","evaluating"):
                job.update(status="failed",error="Interrupted by service restart",finished_at=now())
                store.put("models",job["id"],job)
        yield

    app=FastAPI(title="Northwest NLP Lab",version="0.1.0",lifespan=lifespan)
    app.state.store=store
    app.add_middleware(CORSMiddleware,allow_origins=["http://127.0.0.1:5174","http://localhost:5174"],allow_methods=["GET","POST"],allow_headers=["Content-Type"])

    @app.exception_handler(KeyError)
    async def missing(request,exc):
        return JSONResponse(status_code=404,content={"detail":str(exc).strip("'")})

    @app.exception_handler(ValueError)
    async def invalid(request,exc):
        return JSONResponse(status_code=422,content={"detail":str(exc)})

    def require(kind,key):
        row=store.get(kind,key)
        if row is None: raise KeyError(f"{kind}: {key} not found")
        return row

    @app.get("/api/health")
    def health():
        from .language import annotations
        return {"status":"ok","active_model":store.setting("active_model"),"active_configuration":store.setting("active_config"),"nltk_ready":not annotations("Create a task.")[2],"execution_enabled":False}

    @app.post("/api/analyze")
    def analyze_request(body:AnalyzeRequest):
        return analyze(store,body)

    @app.get("/api/runs")
    def runs(limit:int=Query(default=30,ge=1,le=100)):
        return [{"id":r["id"],"text":r["request"]["text"],"status":r["status"],"created_at":r["created_at"],"versions":r["versions"]} for r in store.all("runs")[:limit]]

    @app.get("/api/runs/{run_id}")
    def run(run_id:str): return require("runs",run_id)

    @app.post("/api/runs/{run_id}/export")
    def export(run_id:str):
        row=require("runs",run_id)
        if row["status"]!="ready": raise HTTPException(409,"Resolve this run's clarification before exporting")
        existing=store.get("exports",run_id)
        if existing: return existing
        payload=build_payload(Command.model_validate(row["command"]),row["record_snapshot"],export=True)
        result={"schema_version":"planner-request-v1","command":row["command"],"planner_request":payload,"versions":row["versions"],"reference_datetime":row["request"]["reference_datetime"],"timezone":row["request"]["timezone"],"notice":"Preview/export only. No request was sent to Northwest Planner."}
        return store.put("exports",run_id,result)

    @app.get("/api/datasets")
    def datasets(): return [{k:v for k,v in row.items() if k!="records"} | {"count":len(row["records"])} for row in store.all("datasets")]

    @app.get("/api/datasets/{dataset_id}")
    def dataset(dataset_id:str): return require("datasets",dataset_id)

    @app.post("/api/datasets/import",status_code=201)
    def import_snapshot(body:SnapshotImport):
        records=[PlannerRecord.model_validate(record).model_dump(mode="json") for record in body.records]
        if any(r["content"]["entity_type"]=="schedule" for r in records): raise ValueError("Only task, reminder and note snapshots are supported")
        keys=[(r["content"]["entity_type"],r["record_id"]) for r in records]
        if len(set(keys))!=len(keys): raise ValueError("Duplicate record ID within an item type")
        row={"id":uid("dataset"),"name":body.name,"version":digest(records),"created_at":now(),"records":records}
        store.put("datasets",row["id"],row)
        return {k:v for k,v in row.items() if k!="records"} | {"count":len(records)}

    @app.get("/api/examples")
    def examples(search:str="",split:str="",offset:int=Query(default=0,ge=0),limit:int=Query(default=50,ge=1,le=100)):
        rows=[r for r in store.all("examples") if search.lower() in r["text"].lower() and (not split or r["split"]==split)]
        return {"total":len(rows),"items":rows[offset:offset+limit],"dataset_version":store.dataset_version()}

    @app.post("/api/examples/review",status_code=201)
    def review(body:Correction):
        original=require("runs",body.run_id)
        text=original["request"]["text"]
        for span in body.spans:
            if not isinstance(span.get("start"),int) or not isinstance(span.get("end"),int) or not 0<=span["start"]<span["end"]<=len(text):
                raise ValueError("Review spans must index the original text")
            if "text" in span and span["text"]!=text[span["start"]:span["end"]]: raise ValueError("Span text does not match original request")
        allowed={"title","due_date","due_time","priority","notes","body","category","estimated_minutes","keep_scheduled"}
        if set(body.fields)-allowed: raise ValueError("Unknown corrected fields")
        if body.expected_status=="ready" and (body.operation=="unsupported" or body.entity_type is None): raise ValueError("Ready examples need a supported action and item type")
        siblings=[r for r in store.all("examples") if r["text"].strip().lower()==text.strip().lower()]
        family=siblings[0]["family"] if siblings else body.family or "review-"+digest(text.lower())
        family_rows=[r for r in store.all("examples") if r["family"]==family]
        split=family_rows[0]["split"] if family_rows else "train"
        row={**body.model_dump(),"id":"review-"+digest({"text":text,"reference":original["request"]["reference_datetime"],"dataset":original["request"]["dataset_id"]}),"text":text,"reference_datetime":original["request"]["reference_datetime"],"timezone":original["request"]["timezone"],"dataset_id":original["request"]["dataset_id"],"selected_record_id":original["command"]["record_id"],"family":family,"split":split,"origin":"human-reviewed","human_reviewed":True,"original_prediction":original,"created_at":now()}
        # Supersede an equal seed example rather than train on conflicting gold.
        for sibling in siblings:
            if sibling["id"]!=row["id"]:
                sibling["approved"]=False
                store.put("examples",sibling["id"],sibling)
        store.put("reviews",uid("review"),row)
        store.put("examples",row["id"],row)
        return {k:v for k,v in row.items() if k!="original_prediction"}

    @app.get("/api/configurations")
    def configurations(): return {"active_id":store.setting("active_config"),"items":store.all("configs")}

    @app.post("/api/configurations",status_code=201)
    def save_configuration(body:Configuration):
        row={"id":uid("config"),"created_at":now(),**body.model_dump()}
        return store.put("configs",row["id"],row)

    @app.post("/api/configurations/{config_id}/activate")
    def activate_configuration(config_id:str):
        require("configs",config_id)
        store.set_setting("active_config",config_id)
        return {"active_id":config_id}

    @app.get("/api/models")
    def models(): return {"active_id":store.setting("active_model"),"items":[public_model(r) for r in store.all("models")]}

    @app.post("/api/training",status_code=202)
    def training(body:TrainRequest,background:BackgroundTasks):
        if any(r["status"] in ("pending","running","evaluating") for r in store.all("models")): raise HTTPException(409,"A training job is already running")
        job=create_training_job(store,body.name)
        background.add_task(train,store,job["id"])
        return public_model(job)

    @app.get("/api/training/{job_id}")
    def training_status(job_id:str): return public_model(require("models",job_id))

    @app.post("/api/models/{model_id}/activate")
    def activate_model(model_id:str):
        row=require("models",model_id)
        if row["status"]!="completed" or row["phase"]!="complete": raise HTTPException(409,"Only fully evaluated models can be activated")
        store.set_setting("active_model",model_id)
        return {"active_id":model_id}

    @app.get("/api/experiments")
    def experiments(): return [public_model(r) for r in store.all("models") if r.get("evaluation")]

    dist=Path(__file__).resolve().parents[1]/"dist"
    if dist.exists(): app.mount("/",StaticFiles(directory=dist,html=True),name="lab-ui")
    return app


app=create_app()
