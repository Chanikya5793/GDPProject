import json
import sqlite3

import pytest

from nlplab import browser
from nlplab.api import create_app


@pytest.fixture
def dispatch(tmp_path, monkeypatch):
    monkeypatch.setattr(browser, 'app', create_app(tmp_path))
    browser.pending_tasks.clear()
    return lambda path, body=None: json.loads(browser.dispatch(path, body))


def test_browser_uses_actual_pipeline_and_stable_export(dispatch):
    result = dispatch('/analyze', {'text': 'Create a task called Chemistry report tomorrow at 3pm with high priority',
                                  'reference_datetime': '2026-10-27T12:00:00-05:00'})
    assert result['ok']
    run = result['data']
    assert run['status'] == 'ready'
    assert len(run['stages']) == 9
    assert run['command']['fields']['due_date'] == '2026-10-28'
    first = dispatch('/runs/' + run['id'] + '/export', {})
    assert first['ok']
    assert dispatch('/runs/' + run['id'] + '/export', {}) == first


def test_browser_reuses_endpoint_validation_and_queries(dispatch):
    assert not dispatch('/analyze', {'text': 'Create a task'})['ok']
    assert not dispatch('/examples?limit=101')['ok']
    assert len(dispatch('/examples?limit=2&split=train')['data']['items']) == 2
    assert dispatch('/models/not-a-model/activate', {})['status'] == 404


def test_browser_keeps_negation_blocked(dispatch):
    run = dispatch('/analyze', {'text': "Don't delete the task Pay rent", 'reference_datetime': '2026-10-27T12:00:00-05:00'})['data']
    assert run['status'] == 'needs_clarification'
    assert not dispatch('/runs/' + run['id'] + '/export', {})['ok']


def test_browser_training_is_queued_not_implicitly_activated(dispatch):
    result = dispatch('/training', {'name': 'Browser test candidate'})
    assert result['ok'] and result['background']
    assert result['data']['status'] == 'pending'
    assert len(browser.pending_tasks) == 1
    assert dispatch('/models')['data']['active_id'] is None


def test_connections_are_closed_after_each_request(dispatch):
    with browser.app.state.store.connect() as connection:
        connection.execute('SELECT 1')
    with pytest.raises(sqlite3.ProgrammingError, match='closed'):
        connection.execute('SELECT 1')
