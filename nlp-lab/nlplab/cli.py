import argparse
import json


def main():
    parser=argparse.ArgumentParser(description="Northwest NLP Lab")
    parser.add_argument("command",choices=["serve","setup-nltk","train","export-corpus"])
    parser.add_argument("--port",type=int,default=8001)
    args=parser.parse_args()
    if args.command=="serve":
        import uvicorn
        uvicorn.run("nlplab.api:app",host="127.0.0.1",port=args.port,workers=1)
    elif args.command=="setup-nltk":
        import nltk
        from .language import RESOURCE_DIR
        RESOURCE_DIR.mkdir(exist_ok=True)
        for resource in ("averaged_perceptron_tagger_eng","wordnet","omw-1.4"):
            if not nltk.download(resource,download_dir=str(RESOURCE_DIR),raise_on_error=True):
                raise SystemExit("NLTK resource download failed")
        print("NLTK resources installed. Runtime NLP can operate offline.")
    else:
        from .api import app
        store=app.state.store
        if args.command=="train":
            from .models import create_training_job, train
            job=create_training_job(store,"Starter corpus baseline")
            train(store,job["id"])
            result=store.get("models",job["id"])
            print(json.dumps({k:v for k,v in result.items() if k not in ("corpus_snapshot","examples_snapshot")},indent=2))
            if result["status"]!="completed": raise SystemExit(1)
        else:
            print(json.dumps(store.all("examples"),indent=2,default=str))


if __name__=="__main__": main()
