"""Transport adapter for the same FastAPI endpoint functions inside Pyodide.

No socket server, remote requests, or alternate NLP implementation is used.
The worker supplies HTTP-like paths and executes background jobs separately.
"""
import inspect
import json
from typing import Annotated
from urllib.parse import parse_qs, urlsplit

from fastapi import BackgroundTasks, HTTPException
from fastapi.params import Query
from pydantic import BaseModel, TypeAdapter, ValidationError

from .api import app

pending_tasks = []


def dispatch(path, body=None):
    url = urlsplit('/api' + path)
    method = 'GET' if body is None else 'POST'
    try:
        for route in app.routes:
            if method not in getattr(route, 'methods', ()):
                continue
            match = route.path_regex.fullmatch(url.path)
            if not match:
                continue
            query = parse_qs(url.query)
            arguments = match.groupdict()
            background = BackgroundTasks()
            for name, parameter in inspect.signature(route.endpoint).parameters.items():
                annotation = parameter.annotation
                if annotation is BackgroundTasks:
                    arguments[name] = background
                elif inspect.isclass(annotation) and issubclass(annotation, BaseModel):
                    arguments[name] = annotation.model_validate(body)
                elif name not in arguments:
                    default = parameter.default
                    if isinstance(default, Query):
                        value = query.get(name, [default.default])[0]
                        arguments[name] = TypeAdapter(Annotated[annotation, default]).validate_python(value)
                    elif name in query:
                        arguments[name] = TypeAdapter(annotation).validate_python(query[name][0])
                    elif default is not inspect.Parameter.empty:
                        arguments[name] = default
            result = route.endpoint(**arguments)
            pending_tasks.extend(background.tasks)
            return json.dumps({'ok': True, 'data': result, 'background': bool(background.tasks)}, default=str)
        raise HTTPException(404, 'Unknown lab endpoint')
    except HTTPException as error:
        return json.dumps({'ok': False, 'status': error.status_code, 'error': str(error.detail)})
    except (ValidationError, ValueError, KeyError) as error:
        return json.dumps({'ok': False, 'status': 422 if not isinstance(error, KeyError) else 404, 'error': str(error)})


def run_pending():
    while pending_tasks:
        task = pending_tasks.pop(0)
        task.func(*task.args, **task.kwargs)


def checkpoint():
    with app.state.store.connect() as database:
        database.execute('PRAGMA wal_checkpoint(TRUNCATE)')
