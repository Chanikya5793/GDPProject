import os
import threading
import platform
from importlib.metadata import version
from functools import lru_cache

import joblib
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import FeatureUnion
from sklearn.svm import LinearSVC

from .language import normalize
from .schemas import AnalyzeRequest, Configuration
from .store import digest, now, uid

TRAIN_LOCK = threading.Lock()


@lru_cache(maxsize=8)
def load_bundle(path):
    # Paths come exclusively from internally generated IDs in SQLite. Imported
    # snapshots and API clients cannot supply or upload pickle artifacts.
    return joblib.load(path)


def predict(store, model_id, text, classifier):
    meta = store.get("models", model_id) if model_id else None
    if not meta or meta.get("status") not in ("completed", "evaluating"):
        return None
    bundle = load_bundle(str(store.models_dir / (model_id + ".joblib")))
    x = bundle["features"].transform([text])
    names = bundle["features"].get_feature_names_out()
    active = sorted(zip(x.indices.tolist(), x.data.tolist()), key=lambda p: -p[1])
    output = {"features": [{"name": str(names[i]), "weight": round(weight, 6)} for i, weight in active], "vocabulary_size": len(names), "classifiers": {}}
    for family, heads in bundle["classifiers"].items():
        result = {}
        for head, model in heads.items():
            probabilities = model.predict_proba(x)[0]
            order = np.argsort(-probabilities)
            label = str(model.classes_[order[0]])
            result[head] = {"label": label, "confidence": float(probabilities[order[0]]), "margin": float(probabilities[order[0]]-probabilities[order[1]]), "ranking": [{"label": str(model.classes_[i]), "probability": round(float(probabilities[i]), 6)} for i in order]}
            # Contributions explain linear decisions (not calibrated
            # probabilities). SVM probabilities are shown separately.
            if hasattr(model, "coef_"):
                index = int(order[0]) if model.coef_.shape[0] > 1 else 0
                coef = model.coef_[index]
                values = [(str(names[i]), weight*float(coef[i])) for i, weight in active]
                result[head]["contributions"] = [{"feature": name, "contribution": round(value, 6)} for name, value in sorted(values, key=lambda p: -abs(p[1]))[:20]]
            elif hasattr(model, "feature_log_prob_"):
                coef = model.feature_log_prob_[int(order[0])]
                result[head]["contributions"] = [{"feature": str(names[i]), "contribution": round(weight*float(coef[i]), 6)} for i, weight in active[:20]]
        output["classifiers"][family] = result
    output["selected"] = output["classifiers"][classifier]
    return output


def metrics(gold, results):
    true_ops = [r["operation"] for r in gold]
    pred_ops = [r["command"]["operation"] for r in results]
    true_entities = [r["entity_type"] or "unknown" for r in gold]
    pred_entities = [r["command"]["entity_type"] or "unknown" for r in results]
    tp = fp = fn = exact = ready_correct = ready = schema_valid = 0
    for expected, result in zip(gold, results):
        actual = result["command"]
        truth = {(k, str(v)) for k, v in {**expected["fields"], **expected.get("filters", {})}.items()}
        guessed = {(k, str(v)) for k, v in {**actual["fields"], **actual["filters"]}.items()}
        tp += len(truth & guessed); fp += len(guessed-truth); fn += len(truth-guessed)
        correct = result["status"] == expected["expected_status"]
        if expected["expected_status"] == "ready":
            correct = correct and actual["operation"] == expected["operation"] and actual["entity_type"] == expected["entity_type"] and truth == guessed and actual["target"] == expected.get("target")
        exact += bool(correct)
        if result["status"] == "ready":
            ready += 1; ready_correct += bool(correct)
            schema_valid += result["payload"] is not None
    labels = sorted(set(true_ops) | set(pred_ops))
    return {"count": len(gold), "action_macro_f1": round(f1_score(true_ops, pred_ops, average="macro", zero_division=0), 4), "entity_macro_f1": round(f1_score(true_entities, pred_entities, average="macro", zero_division=0), 4), "field_f1": round(2*tp/max(1, 2*tp+fp+fn), 4), "exact_payload_accuracy": round(exact/max(1,len(gold)), 4), "schema_validity": round(schema_valid/max(1,ready),4), "clarification_rate": round(sum(r["status"] == "needs_clarification" for r in results)/max(1,len(gold)),4), "coverage": round(ready/max(1,len(gold)),4), "accepted_accuracy": round(ready_correct/max(1,ready),4), "confusion": {"labels": labels, "matrix": confusion_matrix(true_ops, pred_ops, labels=labels).tolist()}}


def train(store, job_id):
    from .pipeline import analyze
    job = store.get("models", job_id)
    if not TRAIN_LOCK.acquire(blocking=False):
        job.update(status="failed", error="Another training job is running", finished_at=now())
        store.put("models", job_id, job)
        return
    try:
        job.update(status="running", phase="fitting training-only vocabulary", started_at=now())
        store.put("models", job_id, job)
        rows = job.pop("examples_snapshot")
        configs = Configuration.model_validate(job["configuration"])
        train_rows = [r for r in rows if r["split"] == "train" and r["approved"]]
        groups = np.array([r["family"] for r in train_rows])
        features = FeatureUnion([("word", TfidfVectorizer(ngram_range=(1,2), sublinear_tf=True)), ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3,5), sublinear_tf=True))])
        texts = [normalize(r["text"], configs)[0] for r in train_rows]
        x = features.fit_transform(texts)
        classifiers = {family: {} for family in ("logistic", "naive_bayes", "svm")}
        for head, key in (("operation", "operation"), ("entity", "entity_type")):
            y = np.array([r[key] or "unknown" for r in train_rows])
            if len(set(y)) < 2 or any(len(set(groups[y == label])) < 3 for label in set(y)):
                raise ValueError(f"{head}: each class needs at least three independent training families")
            classifiers["logistic"][head] = LogisticRegression(max_iter=1500, class_weight="balanced", random_state=42).fit(x,y)
            classifiers["naive_bayes"][head] = MultinomialNB(alpha=0.2).fit(x,y)
            folds = list(StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=42).split(x,y,groups))
            if any(len(set(y[a])) != len(set(y)) or len(set(y[b])) != len(set(y)) for a,b in folds):
                raise ValueError("Grouped calibration folds lack a class; add more independent examples")
            classifiers["svm"][head] = CalibratedClassifierCV(LinearSVC(class_weight="balanced", random_state=42), method="sigmoid", cv=folds).fit(x,y)
        bundle = {"features": features, "classifiers": classifiers, "dataset_version": job["dataset_version"]}
        temporary = store.models_dir / (job_id + ".tmp")
        joblib.dump(bundle, temporary)
        os.replace(temporary, store.models_dir / (job_id + ".joblib"))
        job.update(status="evaluating", phase="evaluating validation and frozen test sets", training_count=len(train_rows))
        # Prediction can load this candidate by ID without activating it.
        store.put("models", job_id, job)
        evaluation, curves = {}, []
        for split in ("validation", "test"):
            gold = [r for r in rows if r["split"] == split and r["approved"]]
            evaluation[split] = {}
            for mode, family in [("rules", "logistic")] + [(mode,family) for mode in ("model", "hybrid") for family in classifiers]:
                cfg = configs.model_copy(update={"mode": mode, "classifier": family})
                results = [analyze(store, AnalyzeRequest(text=row["text"], reference_datetime=row["reference_datetime"], timezone=row["timezone"], dataset_id=row["dataset_id"], selected_record_id=row.get("selected_record_id"), configuration=cfg, model_id=job_id), persist=False, linguistic=False) for row in gold]
                evaluation[split][mode+":"+family] = metrics(gold, results)
                if split == "validation" and mode == "hybrid" and family == "logistic":
                    # Reuse full predictions: only acceptance thresholds differ.
                    for threshold in (0.5,0.6,0.7,0.8,0.9,0.95):
                        selected = []
                        for row, result in zip(gold, results):
                            ranking = result.get("classification", {}).get("selected", {})
                            score = min((v["confidence"] for v in ranking.values()), default=0)
                            if result["status"] == "ready" and score >= threshold:
                                selected.append((row,result))
                        correct = sum(a["operation"] == b["command"]["operation"] and a["entity_type"] == b["command"]["entity_type"] and a["expected_status"] == "ready" for a,b in selected)
                        curves.append({"threshold":threshold,"coverage":len(selected)/max(1,len(gold)),"accepted_intent_accuracy":correct/max(1,len(selected)),"accepted_count":len(selected)})
        job.update(status="completed", evaluation=evaluation, acceptance_curve=curves, phase="complete", finished_at=now(), corpus_snapshot=rows)
        store.put("models", job_id, job)
    except Exception as exc:
        job.update(status="failed", phase="failed", error=f"{type(exc).__name__}: {exc}", finished_at=now())
        store.put("models", job_id, job)
    finally:
        TRAIN_LOCK.release()


def create_training_job(store, name):
    config, config_id = store.configuration()
    rows = store.all("examples")
    # The same group or text can never cross split boundaries.
    families, texts = {}, {}
    for row in rows:
        for table, key in ((families,row["family"]), (texts,row["text"].lower().strip())):
            if key in table and table[key] != row["split"]:
                raise ValueError("Dataset split leakage detected")
            table[key] = row["split"]
    job_id = uid("model")
    job = {"id":job_id,"name":name,"status":"pending","phase":"queued","created_at":now(),"dataset_version":digest(sorted(rows,key=lambda r:r["id"])),"configuration_id":config_id,"configuration":config.model_dump(),"examples_snapshot":rows,"corpus_notice":"Synthetic template corpus plus explicitly reviewed corrections; not a real-user benchmark.","runtime_versions":{"python":platform.python_version(),**{name:version(name) for name in ("scikit-learn","nltk","dateparser","numpy","pydantic")}}}
    store.put("models",job_id,job)
    return job
