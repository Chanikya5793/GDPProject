"""WidgetKit push: registration, delivery after writes, and token hygiene."""
import json

import httpx
from conftest import task_request
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.push import WidgetPusher

TOKEN = "ab" * 32


def pusher(handler, clock=lambda: 1000.0):
    key = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return WidgetPusher(key_pem=key, key_id="KEY123", team_id="TEAM123",
                        topic="com.nwmissouri.studentplanner.push-type.widgets",
                        client_factory=lambda: httpx.Client(transport=httpx.MockTransport(handler)),
                        clock=clock)


def test_registration_requires_a_hex_token(client, auth, services):
    assert client.post("/v1/devices/widget-push", json={"token": "nope"}, headers=auth).status_code == 422
    assert client.post("/v1/devices/widget-push", json={"token": TOKEN.upper(), "environment": "development"},
                       headers=auth).status_code == 204
    assert services.repository.list_widget_push_tokens("alice") == [(TOKEN, "development")]
    assert client.delete(f"/v1/devices/widget-push/{TOKEN}", headers=auth).status_code == 204
    assert services.repository.list_widget_push_tokens("alice") == []


def test_a_committed_write_pushes_to_the_account_widgets(client, auth, services):
    sent = []

    def handler(request):
        sent.append(request)
        return httpx.Response(200)

    services.widget_push = pusher(handler)
    client.post("/v1/devices/widget-push", json={"token": TOKEN}, headers=auth)
    assert sent == []  # registering is not a planner change
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    assert len(sent) == 1
    request = sent[0]
    assert request.url.host == "api.push.apple.com" and request.url.path == f"/3/device/{TOKEN}"
    assert request.headers["apns-push-type"] == "widgets"
    assert request.headers["apns-topic"].endswith(".push-type.widgets")
    assert request.headers["authorization"].startswith("bearer ")
    assert json.loads(request.content) == {"aps": {"content-changed": True}}


def test_a_refused_write_sends_nothing(client, auth, services):
    sent = []
    services.widget_push = pusher(lambda request: sent.append(request) or httpx.Response(200))
    client.post("/v1/devices/widget-push", json={"token": TOKEN}, headers=auth)
    client.put("/v1/records/task/t1", json=task_request(), headers=auth)
    client.put("/v1/records/task/t1", json=task_request("Stale", 0, "request-0002"), headers=auth)
    assert len(sent) == 1


def test_bursts_are_coalesced_without_dropping_the_last_write(services):
    now = [1000.0]
    sent = []
    trailing = []
    push = pusher(lambda request: sent.append(request) or httpx.Response(200), clock=lambda: now[0])
    push.schedule = lambda wait, fire: trailing.append((wait, fire))
    services.repository.save_widget_push_token("alice", TOKEN, "production")
    push.notify("alice", services.repository)
    now[0] += 4
    push.notify("alice", services.repository)
    push.notify("alice", services.repository)
    assert len(sent) == 1 and len(trailing) == 1 and trailing[0][0] == 6
    now[0] += 6
    trailing[0][1]()
    assert len(sent) == 2  # one trailing push for the rest of the burst
    push.notify("alice", services.repository)
    assert len(sent) == 2 and len(trailing) == 2


def test_wrong_environment_is_retried_once_and_remembered(services):
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        if request.url.host == "api.push.apple.com":
            return httpx.Response(400, json={"reason": "BadDeviceToken"})
        return httpx.Response(200)

    services.repository.save_widget_push_token("alice", TOKEN, "production")
    assert pusher(handler).notify("alice", services.repository) == 1
    assert hosts == ["api.push.apple.com", "api.sandbox.push.apple.com"]
    assert services.repository.list_widget_push_tokens("alice") == [(TOKEN, "development")]


def test_unregistered_tokens_are_dropped(services):
    services.repository.save_widget_push_token("alice", TOKEN, "production")
    pusher(lambda request: httpx.Response(410, json={"reason": "Unregistered"})).notify("alice", services.repository)
    assert services.repository.list_widget_push_tokens("alice") == []


def test_disabled_without_a_key(services):
    services.repository.save_widget_push_token("alice", TOKEN, "production")
    assert WidgetPusher().notify("alice", services.repository) == 0
