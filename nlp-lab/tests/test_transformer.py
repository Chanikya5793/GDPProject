import numpy as np
import pytest

from nlplab.schemas import Configuration, TrainRequest
from nlplab.store import Store
from nlplab.transformer import cache_records, inspection, MODEL, REVISION, DIMENSIONS


def record():
    return {'text': 'example', 'vector': [1.0] + [0.0] * (DIMENSIONS - 1), 'input_ids': [101, 102],
            'attention_mask': [1, 1], 'tokens': ['[CLS]', '[SEP]'], 'at_token_limit': False,
            'encoder': {'model': MODEL, 'revision': REVISION, 'dimensions': DIMENSIONS}}


def test_transformer_configuration_is_explicit():
    assert Configuration(classifier='transformer').classifier == 'transformer'
    assert TrainRequest(include_transformer=True).include_transformer
    assert not TrainRequest().include_transformer


@pytest.mark.parametrize('change', ['dimension', 'nan', 'revision', 'unnormalized'])
def test_invalid_encoder_cache_cannot_be_used_as_a_model_feature(tmp_path, change):
    row = record()
    if change == 'dimension': row['vector'] = [1.0]
    if change == 'nan': row['vector'][0] = float('nan')
    if change == 'revision': row['encoder']['revision'] = 'other-model'
    if change == 'unnormalized': row['vector'][0] = 5.0
    with pytest.raises(ValueError):
        cache_records(Store(tmp_path), [row])


def test_inspection_preserves_model_tokens_and_distinguishes_attention_from_attribution(tmp_path):
    # A synthetic vector tests the cache contract only. Real inference is covered
    # by the production-build browser test using the downloaded ONNX model.
    store = Store(tmp_path)
    cache_records(store, [record()])
    result = inspection(store, 'example')
    assert result['dimensions'] == 384
    assert result['input_ids'] == [101, 102]
    assert np.isclose(result['embedding_norm'], 1.0)
    assert 'not exported' in result['attention_note']
