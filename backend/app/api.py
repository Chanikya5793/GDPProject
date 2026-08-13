from __future__ import annotations

import hashlib
import json
import os
from typing import Annotated, Any, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import CurrentUser
from .config import get_settings
from .models import (
    ActionProposal,
    ChatRequest,
    ChatResponse,
    ConfirmProposalRequest,
    EntityType,
    IndexRequest,
    MigrationRequest,
    MigrationResult,
    PlannerRecord,
    PrivacySettings,
    RecordDeleteRequest,
    RecordUpsertRequest,
    RejectProposalRequest,
)
from .proposals import InvalidProposal
from .repository import IdempotencyConflict, NotFound, RevisionConflict
from .runtime import Container, build_production_container


class McpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jsonrpc: str = Field(pattern=r"^2\.0$")
    id: Optional[Any] = None
    method: str
    params: Dict[str, Any] = Field(default_factory=dict)


def get_container(request: Request) -> Container:
    container = getattr(request.app.state, "container", None)
    if container is None:
        try:
            container = build_production_container(get_settings())
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail="Planner cloud services are not configured or unavailable",
            ) from exc
        request.app.state.container = container
    return container


ContainerDep = Annotated[Container, Depends(get_container)]


def create_app(container: Container | None = None) -> FastAPI:
    app = FastAPI(
        title="Northwest Planner Copilot API",
        version="1.0.0",
        docs_url=None if os.getenv("PLANNER_ENVIRONMENT") == "production" else "/docs",
        redoc_url=None,
    )
    app.state.container = container
    raw_origins = os.getenv("PLANNER_ALLOWED_ORIGINS", '["http://localhost:5173"]')
    try:
        origins = json.loads(raw_origins)
    except json.JSONDecodeError:
        origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Mcp-Session-Id", "Idempotency-Key"],
        expose_headers=["Mcp-Session-Id"],
    )

    @app.exception_handler(RevisionConflict)
    async def revision_conflict(_request: Request, exc: RevisionConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "stale_revision"})

    @app.exception_handler(IdempotencyConflict)
    async def idempotency_conflict(_request: Request, exc: IdempotencyConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "idempotency_conflict"})

    @app.exception_handler(NotFound)
    async def not_found(_request: Request, exc: NotFound):
        return JSONResponse(status_code=404, content={"detail": str(exc), "code": "not_found"})

    @app.exception_handler(InvalidProposal)
    async def invalid_proposal(_request: Request, exc: InvalidProposal):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "invalid_proposal"})

    @app.get("/healthz")
    def health() -> Dict[str, Any]:
        return {"status": "ok", "cloud_services_initialized": app.state.container is not None}

    @app.get("/v1/records/{entity_type}", response_model=list[PlannerRecord])
    def list_records(entity_type: EntityType, user: CurrentUser, services: ContainerDep):
        return services.repository.list_records(user.uid, entity_type)

    @app.get("/v1/records/{entity_type}/{record_id}", response_model=PlannerRecord)
    def get_record(entity_type: EntityType, record_id: str, user: CurrentUser, services: ContainerDep):
        return services.repository.get_record(user.uid, entity_type, record_id)

    @app.put("/v1/records/{entity_type}/{record_id}", response_model=PlannerRecord)
    def upsert_record(
        entity_type: EntityType, record_id: str, body: RecordUpsertRequest,
        user: CurrentUser, services: ContainerDep,
    ):
        return services.repository.upsert_record(user.uid, entity_type, record_id, body)

    @app.delete("/v1/records/{entity_type}/{record_id}", status_code=204)
    def delete_record(
        entity_type: EntityType, record_id: str, body: RecordDeleteRequest,
        user: CurrentUser, services: ContainerDep,
    ) -> Response:
        services.repository.delete_record(
            user.uid, entity_type, record_id, body.expected_revision, body.idempotency_key
        )
        services.vector_store.delete_record(user.uid, entity_type, record_id)
        services.audit.record(user.uid, "deletion", metadata={"entity_type": entity_type.value})
        return Response(status_code=204)

    @app.post("/v1/migrations/local-storage", response_model=MigrationResult)
    def migrate_local_storage(body: MigrationRequest, user: CurrentUser, services: ContainerDep):
        imported = 0
        skipped = 0
        record_ids = []
        for item in body.items:
            digest = hashlib.sha256(f"{item.legacy_key}:{item.legacy_id}".encode()).hexdigest()[:24]
            record_id = f"legacy_{digest}"
            idem_suffix = hashlib.sha256(record_id.encode()).hexdigest()[:16]
            try:
                services.repository.get_record(user.uid, item.content.entity_type, record_id)
                existed = True
            except NotFound:
                existed = False
            if existed:
                record_ids.append(record_id)
                skipped += 1
                continue
            services.repository.upsert_record(
                user.uid, item.content.entity_type, record_id,
                RecordUpsertRequest(
                    content=item.content,
                    expected_revision=None if not existed else 1,
                    idempotency_key=f"{body.migration_id}:{idem_suffix}",
                    approved_for_ai=item.approved_for_ai,
                ),
            )
            record_ids.append(record_id)
            imported += 1
        return MigrationResult(
            migration_id=body.migration_id, imported=imported, skipped=skipped, record_ids=record_ids
        )

    @app.get("/v1/privacy", response_model=PrivacySettings)
    def get_privacy(user: CurrentUser, services: ContainerDep):
        return services.repository.get_privacy(user.uid)

    @app.put("/v1/privacy", response_model=PrivacySettings)
    def set_privacy(body: PrivacySettings, user: CurrentUser, services: ContainerDep):
        result = services.repository.set_privacy(user.uid, body)
        if not body.ai_enabled:
            services.indexing.delete_user_index(user.uid)
        services.audit.record(user.uid, "privacy_changed", metadata={
            "ai_enabled": body.ai_enabled, "attachment_indexing": body.index_attachments,
            "chat_retention_days": body.chat_retention_days if body.retain_chat else 0,
        })
        return result

    @app.post("/v1/index/{entity_type}/{record_id}", status_code=202)
    def index_record(
        entity_type: EntityType, record_id: str, body: IndexRequest,
        user: CurrentUser, services: ContainerDep,
    ):
        try:
            services.indexing.index(user.uid, entity_type, record_id, body.expected_revision)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"status": "indexed", "record_id": record_id, "revision": body.expected_revision}

    @app.delete("/v1/index", status_code=200)
    def delete_index(user: CurrentUser, services: ContainerDep):
        return {"deleted": services.indexing.delete_user_index(user.uid)}

    @app.post("/v1/copilot/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, user: CurrentUser, services: ContainerDep):
        try:
            answer, citations, disclosure, generated = services.copilot.answer(user.uid, body.message)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        proposals: list[ActionProposal] = []
        if generated.action:
            proposal = services.proposals.from_generated_action(user.uid, generated.action, answer)
            if proposal:
                proposals.append(proposal)
        return ChatResponse(
            answer=answer, citations=citations, retrieval=disclosure, proposals=proposals
        )

    @app.post("/v1/proposals/{proposal_id}/confirm", response_model=ActionProposal)
    def confirm_proposal(
        proposal_id: str, body: ConfirmProposalRequest,
        user: CurrentUser, services: ContainerDep,
    ):
        return services.proposals.confirm(
            user.uid, proposal_id, body.idempotency_key, body.expected_base_revision
        )

    @app.post("/v1/proposals/{proposal_id}/reject", response_model=ActionProposal)
    def reject_proposal(
        proposal_id: str, _body: RejectProposalRequest,
        user: CurrentUser, services: ContainerDep,
    ):
        return services.proposals.reject(user.uid, proposal_id)

    @app.post("/v1/proposals/{proposal_id}/cancel", response_model=ActionProposal)
    def cancel_proposal(proposal_id: str, user: CurrentUser, services: ContainerDep):
        return services.proposals.cancel(user.uid, proposal_id)

    @app.post("/mcp")
    def mcp(
        body: McpRequest, user: CurrentUser, services: ContainerDep,
        mcp_session_id: Annotated[Optional[str], Header(alias="Mcp-Session-Id")] = None,
    ):
        try:
            if body.method == "initialize":
                session_id = services.mcp_sessions.issue(user.uid)
                return JSONResponse(
                    content={"jsonrpc": "2.0", "id": body.id, "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "northwest-planner", "version": "1.0.0"},
                    }}, headers={"Mcp-Session-Id": session_id},
                )
            if not mcp_session_id:
                raise PermissionError("Mcp-Session-Id is required after initialization")
            services.mcp_sessions.verify(mcp_session_id, user.uid)
            if body.method == "notifications/initialized":
                return Response(status_code=202)
            if body.method == "tools/list":
                result = {"tools": services.mcp_tools.TOOL_SCHEMAS}
            elif body.method == "tools/call":
                name = str(body.params.get("name", ""))
                arguments = body.params.get("arguments") or {}
                output = services.mcp_tools.call(user.uid, name, arguments)
                result = {"content": [{"type": "text", "text": json.dumps(output, default=str)}],
                          "isError": False}
            else:
                return JSONResponse(status_code=404, content={
                    "jsonrpc": "2.0", "id": body.id,
                    "error": {"code": -32601, "message": "Method not found"},
                })
            return {"jsonrpc": "2.0", "id": body.id, "result": result}
        except (PermissionError, KeyError, ValueError) as exc:
            return JSONResponse(status_code=403, content={
                "jsonrpc": "2.0", "id": body.id,
                "error": {"code": -32001, "message": str(exc)},
            })

    return app


app = create_app()
