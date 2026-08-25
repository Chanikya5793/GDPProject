from __future__ import annotations

from datetime import date

from conftest import task_request

from app.models import PlannerRecord, TaskContent
from app.planner import DEFAULT_MAX_DAILY_MINUTES, PlannerEngine

TODAY = date(2026, 8, 24)


def overload_facts(recommendations):
    return [r.facts for r in recommendations if r.kind == "overload"]


def build_tasks(minutes_each, count, due="2026-08-30"):
    return [
        PlannerRecord(
            record_id=f"t{index}",
            revision=1,
            content=TaskContent(
                title=f"Task {index}", due_date=date.fromisoformat(due), priority="medium",
                category="Homework", notes="", completed=False, estimated_minutes=minutes_each,
            ),
            approved_for_ai=True,
            created_at="2026-08-01T00:00:00Z",
            updated_at="2026-08-01T00:00:00Z",
        )
        for index in range(count)
    ]


class TestEngineCapacity:
    def test_defaults_to_the_deployment_value(self):
        engine = PlannerEngine()
        assert engine.max_daily_minutes == DEFAULT_MAX_DAILY_MINUTES
        assert engine.capacity() == DEFAULT_MAX_DAILY_MINUTES

    def test_per_call_override_wins_over_the_deployment_default(self):
        engine = PlannerEngine(max_daily_minutes=600)
        assert engine.capacity(120) == 120
        # None means "no user preference", so the deployment default applies.
        assert engine.capacity(None) == 600

    def test_override_changes_whether_a_day_is_overloaded(self):
        engine = PlannerEngine(max_daily_minutes=600)
        records = build_tasks(minutes_each=60, count=5)  # 300 minutes

        assert overload_facts(engine.analyze(records, TODAY)) == []

        tightened = overload_facts(engine.analyze(records, TODAY, max_daily_minutes=120))
        assert len(tightened) == 1
        assert tightened[0]["total_minutes"] == 300
        # The reported capacity must be the one actually applied, not the default.
        assert tightened[0]["capacity_minutes"] == 120

    def test_next_available_day_respects_the_override(self):
        engine = PlannerEngine(max_daily_minutes=600)
        records = build_tasks(minutes_each=300, count=1, due="2026-08-25")

        # 300 already booked; 300 more still fits under the 600 default.
        assert engine.next_available_day(records, date(2026, 8, 24), 300) == date(2026, 8, 25)
        # Under a 400 cap that day is full, so it rolls to the next one.
        assert engine.next_available_day(
            records, date(2026, 8, 24), 300, max_daily_minutes=400
        ) == date(2026, 8, 26)


class TestPlannerSettingsApi:
    def test_defaults_to_no_override(self, client, auth):
        response = client.get("/v1/planner-settings", headers=auth)
        assert response.status_code == 200
        assert response.json() == {"max_daily_minutes": None}

    def test_round_trips_a_user_value(self, client, auth):
        saved = client.put(
            "/v1/planner-settings", headers=auth, json={"max_daily_minutes": 240}
        )
        assert saved.status_code == 200
        assert saved.json()["max_daily_minutes"] == 240
        assert client.get("/v1/planner-settings", headers=auth).json()["max_daily_minutes"] == 240

    def test_clearing_the_value_restores_the_deployment_default(self, client, auth):
        client.put("/v1/planner-settings", headers=auth, json={"max_daily_minutes": 240})
        cleared = client.put("/v1/planner-settings", headers=auth, json={"max_daily_minutes": None})
        assert cleared.json()["max_daily_minutes"] is None

    def test_rejects_values_outside_the_supported_range(self, client, auth):
        assert client.put(
            "/v1/planner-settings", headers=auth, json={"max_daily_minutes": 5}
        ).status_code == 422
        assert client.put(
            "/v1/planner-settings", headers=auth, json={"max_daily_minutes": 5000}
        ).status_code == 422

    def test_rejects_unknown_fields(self, client, auth):
        response = client.put(
            "/v1/planner-settings", headers=auth,
            json={"max_daily_minutes": 240, "max_daily_tasks": 3},
        )
        assert response.status_code == 422

    def test_requires_authentication(self, client):
        assert client.get("/v1/planner-settings").status_code == 401
        assert client.put("/v1/planner-settings", json={"max_daily_minutes": 240}).status_code == 401

    def test_settings_are_per_user(self, client):
        alice = {"Authorization": "Bearer uid:alice"}
        bob = {"Authorization": "Bearer uid:bob"}
        client.put("/v1/planner-settings", headers=alice, json={"max_daily_minutes": 240})
        assert client.get("/v1/planner-settings", headers=bob).json()["max_daily_minutes"] is None


class TestWorkloadSummaryUsesTheUserValue:
    def _seed(self, client, auth, minutes, count):
        for index in range(count):
            body = task_request(
                title=f"Task {index}", key=f"seedkey-{index:04d}", approved=True
            )
            body["content"]["estimated_minutes"] = minutes
            assert client.put(f"/v1/records/task/t{index}", headers=auth, json=body).status_code == 200

    def _summary(self, client, auth):
        response = client.post("/mcp", headers=auth, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {},
        })
        session = response.headers["Mcp-Session-Id"]
        call = client.post("/mcp", headers={**auth, "Mcp-Session-Id": session}, json={
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "workload_summary", "arguments": {}},
        })
        return call.json()

    def test_tightening_the_user_capacity_surfaces_an_overload(self, client, auth, services):
        services.planner = PlannerEngine(max_daily_minutes=600)
        services.mcp_tools.planner = services.planner
        self._seed(client, auth, minutes=60, count=5)  # 300 minutes on one day

        assert "overload" not in str(self._summary(client, auth))

        client.put("/v1/planner-settings", headers=auth, json={"max_daily_minutes": 120})
        assert "overload" in str(self._summary(client, auth))
