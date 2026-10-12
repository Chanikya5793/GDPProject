"""The change marker other devices listen to, and widget-side completion."""
from conftest import task_request


def test_every_write_moves_the_change_marker(client, auth, services):
    repo = services.repository
    assert repo.get_sync_version("alice") == 0
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    after_create = repo.get_sync_version("alice")
    assert after_create > 0
    client.put("/v1/records/task/t1", json=task_request("Edited", 1, "request-0002"), headers=auth)
    after_edit = repo.get_sync_version("alice")
    assert after_edit > after_create
    client.request("DELETE", "/v1/records/task/t1",
                   json={"expected_revision": 2, "idempotency_key": "request-0003"}, headers=auth)
    assert repo.get_sync_version("alice") > after_edit
    assert repo.get_sync_version("bob") == 0


def test_a_replayed_write_does_not_move_the_marker(client, auth, services):
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    version = services.repository.get_sync_version("alice")
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    assert services.repository.get_sync_version("alice") == version


def test_complete_marks_done_and_keeps_the_rest(client, auth):
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    done = client.post("/v1/records/task/t1/complete",
                       json={"expected_revision": 1, "idempotency_key": "widget-0001"}, headers=auth)
    assert done.status_code == 200
    body = done.json()
    assert body["content"]["completed"] is True
    assert body["content"]["notes"] == "Use sources"
    assert body["revision"] == 2


def test_complete_is_idempotent_and_tolerates_another_device(client, auth):
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    first = client.post("/v1/records/task/t1/complete",
                        json={"expected_revision": 1, "idempotency_key": "widget-0001"}, headers=auth)
    # A retry, or a second device completing the same item from stale data.
    again = client.post("/v1/records/task/t1/complete",
                        json={"expected_revision": 1, "idempotency_key": "widget-0002"}, headers=auth)
    assert again.status_code == 200
    assert again.json()["revision"] == first.json()["revision"]


def test_complete_refuses_an_item_edited_since_it_was_shown(client, auth):
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    client.put("/v1/records/task/t1", json=task_request("Moved", 1, "request-0002"), headers=auth)
    stale = client.post("/v1/records/task/t1/complete",
                        json={"expected_revision": 1, "idempotency_key": "widget-0001"}, headers=auth)
    assert stale.status_code == 409


def test_complete_is_only_for_tasks_and_reminders(client, auth):
    note = {"content": {"entity_type": "note", "title": "N", "body": "b"},
            "expected_revision": None, "idempotency_key": "request-0001"}
    client.put("/v1/records/note/n1", json=note, headers=auth)
    response = client.post("/v1/records/note/n1/complete",
                           json={"idempotency_key": "widget-0001"}, headers=auth)
    assert response.status_code == 422
    missing = client.post("/v1/records/task/nope/complete",
                          json={"idempotency_key": "widget-0002"}, headers=auth)
    assert missing.status_code == 404
