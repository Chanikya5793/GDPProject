import re
import time
from difflib import SequenceMatcher

from pydantic import ValidationError

from .extraction import extract
from .language import annotations, classify_rules, guards, normalize
from .models import predict
from .planner_contract_v1 import PlannerRecord, RecordDeleteRequest, RecordUpsertRequest
from .schemas import AnalyzeRequest, Command, Stage
from .store import digest, now, uid

STAGES = [("input","Input & context"),("normalization","Normalization"),("linguistic","Linguistic analysis"),("features","Feature extraction"),("classification","Action & item classification"),("extraction","Field extraction"),("dates","Date interpretation"),("target","Target resolution"),("validation","Validation & payload")]


def build_payload(command, record=None, *, export=False):
    operation, entity = command.operation, command.entity_type
    if operation == "find":
        return {"method":"GET","path":f"/v1/records/{entity}","body":None,"local_filters":command.filters,"notice":"Filters apply to the returned collection locally; this preview does not send a request."}
    key = uid("nlplab") if export else "preview-idempotency-key"
    record_id = record["record_id"] if record else (uid("record") if export else "preview-record")
    if operation == "delete":
        body = RecordDeleteRequest(expected_revision=record["revision"],idempotency_key=key).model_dump(mode="json")
        return {"method":"DELETE","path":f"/v1/records/{entity}/{record_id}","body":body}
    content = dict(record["content"]) if record else {"entity_type":entity}
    changes = dict(command.fields)
    if entity == "reminder":
        for source,target in (("due_date","date"),("due_time","time")):
            if source in changes:
                changes[target] = changes.pop(source)
    if operation == "complete":
        changes["completed"] = True
    content.update(changes)
    request = RecordUpsertRequest(content=content,expected_revision=record["revision"] if record else 0,idempotency_key=key,approved_for_ai=record["approved_for_ai"] if record else False)
    return {"method":"PUT","path":f"/v1/records/{entity}/{record_id}","body":request.model_dump(mode="json")}


def analyze(store, request: AnalyzeRequest, *, persist=True, linguistic=True):
    begin = time.perf_counter()
    config, config_id = (request.configuration,"draft-"+digest(request.configuration.model_dump())) if request.configuration else store.configuration(request.configuration_id)
    dataset = store.get("datasets",request.dataset_id)
    if not dataset:
        raise KeyError("Planner dataset not found")
    model_id = request.model_id or store.setting("active_model")
    if request.model_id and not store.get("models",request.model_id):
        raise KeyError("Model not found")
    stages = []
    last = begin
    def stage(index, source=None, output=None, evidence=None, warnings=None, skipped=False):
        nonlocal last
        current = time.perf_counter()
        stages.append(Stage(id=STAGES[index][0],label=STAGES[index][1],input=source,output=output,evidence=evidence or [],warnings=warnings or [],status="skipped" if skipped else "warning" if warnings else "completed",elapsed_ms=round((current-last)*1000,3)).model_dump())
        last=current
    stage(0,request.text,{"original_text":request.text,"reference_datetime":request.reference_datetime.isoformat(),"timezone":request.timezone,"dataset":dataset["name"]})
    normalized, mapping, edits, suggestions = normalize(request.text,config)
    stage(1,request.text,{"text":normalized,"changes":edits,"spelling_suggestions":suggestions,"normalized_to_original_offsets":mapping},evidence=edits)
    tokens, chunks, warnings = annotations(request.text) if linguistic else ([],[],[])
    stage(2,request.text,{"tokens":tokens,"chunks":chunks},warnings=warnings,skipped=not linguistic)
    classification = predict(store,model_id,normalized,config.classifier)
    stage(3,normalized,{"active_features":classification["features"] if classification else [],"vocabulary_size":classification["vocabulary_size"] if classification else 0,"feature_branches":["word TF-IDF (1–2 grams)","character TF-IDF (3–5 grams)"]},warnings=[] if classification else ["No trained model selected. Features are unavailable until a candidate is trained."],skipped=classification is None)
    rule_op,rule_entity,rule_evidence = classify_rules(normalized,config)
    operation, entity = rule_op, rule_entity
    reasons=[]
    if config.mode == "model":
        if not classification:
            reasons.append("Model-only mode needs a trained model.")
            operation,entity="unsupported",None
        else:
            operation = classification["selected"]["operation"]["label"]
            entity = classification["selected"]["entity"]["label"]
            entity = None if entity == "unknown" else entity
    elif config.mode == "hybrid" and classification:
        operation = rule_op if rule_op != "unsupported" else classification["selected"]["operation"]["label"]
        entity = rule_entity or classification["selected"]["entity"]["label"]
        entity = None if entity == "unknown" else entity
        for head,rule_value in (("operation",rule_op),("entity",rule_entity)):
            prediction = classification["selected"][head]
            if rule_value and rule_value != "unsupported" and prediction["label"] != rule_value and prediction["confidence"] >= config.min_confidence:
                reasons.append(f"Rule/model conflict for {head}: {rule_value} vs {prediction['label']}.")
    if classification and config.mode != "rules":
        for head in ("operation","entity"):
            pred=classification["selected"][head]
            if config.mode == "model" or (head == "operation" and rule_op == "unsupported") or (head == "entity" and rule_entity is None):
                if pred["confidence"] < config.min_confidence or pred["margin"] < config.min_margin:
                    reasons.append(f"Uncertain {head} prediction; clarify the request.")
    for item in rule_evidence:
        a,b=item["start"],item["end"]
        if 0<=a<b<=len(mapping):
            item["start"],item["end"]=mapping[a],mapping[b-1]+1
            item["text"]=request.text[item["start"]:item["end"]]
    stage(4,normalized,{"operation":operation,"entity_type":entity,"mode":config.mode,"rules":{"operation":rule_op,"entity_type":rule_entity},"classifiers":classification["classifiers"] if classification else {}},rule_evidence,warnings=reasons.copy())
    fields,filters,target,field_evidence,date_evidence,extraction_reasons = extract(normalized,operation,entity,config,request.reference_datetime,request.timezone)
    reasons += extraction_reasons
    # Convert extracted spans back to the original text after normalization.
    for item in field_evidence+date_evidence:
        a,b=item["start"],item["end"]
        if 0 <= a < b <= len(mapping):
            item["normalized_text"] = item["text"]
            item["start"],item["end"] = mapping[a],mapping[b-1]+1
            item["text"] = request.text[item["start"]:item["end"]]
            if item.get("field") in ("title","body","notes"):
                fields[item["field"]]=item["text"].strip().strip('"“”')
                item["value"]=fields[item["field"]]
            elif item.get("field")=="target":
                target=item["text"].strip().strip('"“”')
                item["value"]=target
                if operation=="find" and "query" in filters: filters["query"]=target
    stage(5,normalized,{"fields":fields,"filters":filters,"target":target},field_evidence)
    stage(6,{"reference":request.reference_datetime.isoformat(),"timezone":request.timezone},{key:value for key,value in fields.items() if key.startswith("due_")} or {key:value for key,value in filters.items() if key.startswith("due_")},date_evidence,warnings=extraction_reasons,skipped=not date_evidence)
    guard_reasons,is_unsupported=guards(normalized,operation,entity)
    reasons += guard_reasons
    record,candidates=None,[]
    if operation not in ("create","find","unsupported") and entity:
        pool=[r for r in dataset["records"] if r["content"]["entity_type"] == entity]
        exact=[r for r in pool if target and r["content"]["title"].strip().casefold() == target.strip().casefold()]
        if request.selected_record_id:
            record=next((r for r in pool if r["record_id"] == request.selected_record_id),None)
            if not record:
                reasons.append("Selected record is not in this dataset and item type.")
        elif len(exact)==1:
            record=exact[0]
        if not record:
            reasons.append("Select a target record; there is no unique exact match.")
        candidates=sorted([{"record_id":r["record_id"],"title":r["content"]["title"],"revision":r["revision"],"score":round(SequenceMatcher(None,(target or "").casefold(),r["content"]["title"].casefold()).ratio(),4)} for r in pool],key=lambda r:-r["score"])[:8]
    matches=[]
    if operation=="find":
        for candidate in dataset["records"]:
            content=candidate["content"]
            if content["entity_type"]!=entity: continue
            if filters.get("query") and filters["query"].casefold() not in (content["title"]+" "+content.get("body",content.get("notes",""))).casefold(): continue
            if "due_date" in filters and filters["due_date"]!=content.get("due_date",content.get("date")): continue
            if "due_time" in filters and filters["due_time"]!=content.get("due_time",content.get("time")): continue
            day=content.get("due_date",content.get("date"))
            if "due_before" in filters and (not day or day>=filters["due_before"]): continue
            if "due_after" in filters and (not day or day<=filters["due_after"]): continue
            if "due_on_or_before" in filters and (not day or day>filters["due_on_or_before"]): continue
            if any(content.get(key)!=filters[key] for key in ("priority","completed") if key in filters): continue
            matches.append(candidate)
    stage(7,target,{"selected":record,"candidates":candidates,"find_results":matches},skipped=operation in ("create","unsupported"))
    if not entity and operation!="unsupported": reasons.append("Specify task, reminder, or note.")
    if operation=="create" and not fields.get("title"): reasons.append("A new item requires a title.")
    if operation=="create" and entity=="reminder" and "due_date" not in fields: reasons.append("A reminder requires a date.")
    if operation=="reschedule" and "due_date" not in fields: reasons.append("Rescheduling requires a new date.")
    if operation=="update" and not fields: reasons.append("Specify the field and new value to update.")
    if entity!="task" and ("priority" in fields or "priority" in filters): reasons.append("Priority applies to tasks only.")
    if entity=="note" and any(key in filters for key in ("completed","due_date","due_time","due_before","due_after","due_on_or_before")): reasons.append("Notes have no completion or scheduling fields to filter.")
    payload=None
    command=Command(operation=operation,entity_type=entity,target=target,record_id=record["record_id"] if record else None,fields=fields,filters=filters)
    if operation=="unsupported":
        reasons.append("No supported planner action identified.")
        is_unsupported=True
    if not reasons:
        try:
            payload=build_payload(command,record)
        except (ValidationError,ValueError,KeyError) as exc:
            reasons.append(f"Planner contract validation: {exc}")
    status="unsupported" if is_unsupported else "needs_clarification" if reasons else "ready"
    stage(8,command.model_dump(),{"status":status,"payload":payload},warnings=reasons)
    result={"id":uid("run"),"created_at":now(),"request":request.model_dump(mode="json"),"status":status,"command":command.model_dump(),"payload":payload,"reasons":list(dict.fromkeys(reasons)),"stages":stages,"classification":classification,"target_candidates":candidates,"find_results":matches,"record_snapshot":record,"versions":{"model":model_id or "none","dataset":dataset["version"],"configuration":config_id,"rules":"rules-v1-"+digest([r.model_dump() for r in config.rules]),"training_dataset":store.get("models",model_id).get("dataset_version") if model_id and store.get("models",model_id) else None},"configuration_snapshot":config.model_dump(),"elapsed_ms":round((time.perf_counter()-begin)*1000,3)}
    if persist: store.put("runs",result["id"],result)
    return result
