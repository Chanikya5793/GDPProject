"""Pinned real ONNX Transformer embeddings, shared with the browser runtime."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

MODEL = 'Xenova/all-MiniLM-L6-v2'
REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'
DIMENSIONS = 384
_CACHES = {}


def cached(store):
    identity = str(store.path)
    if identity not in _CACHES:
        _CACHES[identity] = {key(row['text']): row for row in store.all('embeddings')}
    return _CACHES[identity]


def key(text):
    from .store import digest
    return digest([MODEL, REVISION, text])


def cache_records(store, records):
    checked = []
    for record in records:
        vector = np.asarray(record['vector'], dtype=float)
        if record['encoder']['model'] != MODEL or record['encoder']['revision'] != REVISION:
            raise ValueError('Transformer encoder revision mismatch')
        if vector.shape != (DIMENSIONS,) or not np.isfinite(vector).all() or not np.isclose(np.linalg.norm(vector), 1, atol=0.01):
            raise ValueError('Invalid Transformer sentence embedding')
        checked.append((key(record['text']), record))
    with store.connect() as database:
        database.executemany("INSERT OR REPLACE INTO items(kind,id,data) VALUES ('embeddings',?,?)", [(identifier, json.dumps(row)) for identifier, row in checked])
    cached(store).update(checked)


def ensure_vectors(store, texts):
    missing = list(dict.fromkeys(text for text in texts if key(text) not in cached(store)))
    if not missing:
        return
    if sys.platform == 'emscripten':
        raise ValueError('Transformer embeddings must be prepared by the browser worker')
    node = shutil.which('node')
    if not node:
        raise ValueError('Transformer mode requires Node.js and npm ci in nlp-lab')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '--max-old-space-size=4096', str(root / 'scripts/transformer_encode.mjs')], input=json.dumps(missing),
                            cwd=root, text=True, capture_output=True, timeout=600)
    if result.returncode:
        raise ValueError('Transformer encoding failed: ' + result.stderr[-1800:])
    cache_records(store, json.loads(result.stdout))


def matrix(store, texts):
    ensure_vectors(store, texts)
    return np.asarray([cached(store)[key(text)]['vector'] for text in texts], dtype=float)


def inspection(store, text):
    record = cached(store).get(key(text))
    if not record:
        return None
    return {**record['encoder'], 'tokens': record['tokens'], 'input_ids': record['input_ids'],
            'attention_mask': record['attention_mask'], 'embedding_preview': record['vector'][:24],
            'embedding_norm': float(np.linalg.norm(record['vector'])), 'at_token_limit': record['at_token_limit'],
            'attention_note': 'Self-attention runs inside the encoder; attention matrices are not exported by this ONNX model.'}
