from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import CurrentUser
from .signup_policy import get_signup_policy
from .config import get_settings
from .models import (
    ActionProposal,
    AiProviderInfo,
    ChatRequest,
    ChatResponse,
    ConfirmProposalRequest,
    EntityType,
    IndexRequest,
    MigrationRequest,
    MigrationResult,
    PlannerRecord,
    PlannerSettings,
    PrivacySettings,
    RecordDeleteRequest,
    RecordUpsertRequest,
    RejectProposalRequest,
)
from .proposals import InvalidProposal
from .ratelimit import RateLimitExceeded
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
        expose_headers=["Mcp-Session-Id", "Retry-After"],
    )

    @app.exception_handler(RevisionConflict)
    async def revision_conflict(_request: Request, exc: RevisionConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "stale_revision"})

    @app.exception_handler(IdempotencyConflict)
    async def idempotency_conflict(_request: Request, exc: IdempotencyConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "idempotency_conflict"})

    @app.exception_handler(RateLimitExceeded)
    async def rate_limited(_request: Request, exc: RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"detail": str(exc), "code": "rate_limited"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )

    @app.exception_handler(NotFound)
    async def not_found(_request: Request, exc: NotFound):
        return JSONResponse(status_code=404, content={"detail": str(exc), "code": "not_found"})

    @app.exception_handler(InvalidProposal)
    async def invalid_proposal(_request: Request, exc: InvalidProposal):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "invalid_proposal"})

    @app.get("/v1/signup-policy")
    def signup_policy() -> Dict[str, Any]:
        # Public on purpose: the sign-up form needs it before anyone has a token,
        # and it discloses nothing beyond which domains may register. Advisory
        # only — the binding check runs on every authenticated request.
        policy = get_signup_policy()
        return {
            "enforce": policy.enforce,
            "allowed_domains": policy.allowed_domains,
            "message": policy.describe(),
        }

    @app.get("/healthz")
    def health(_services: ContainerDep) -> Dict[str, Any]:
        return {"status": "ok", "cloud_services_initialized": True}

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

    @app.get("/v1/ai-info", response_model=AiProviderInfo)
    def ai_info(_user: CurrentUser, services: ContainerDep):
        generator = services.copilot.generator
        return AiProviderInfo(
            provider=getattr(generator, "provider", "unknown"),
            model=getattr(generator, "model", "unknown"),
            trains_on_prompts=bool(getattr(generator, "trains_on_prompts", False)),
        )

    @app.get("/v1/planner-settings", response_model=PlannerSettings)
    def get_planner_settings(user: CurrentUser, services: ContainerDep):
        return services.repository.get_planner_settings(user.uid)

    @app.put("/v1/planner-settings", response_model=PlannerSettings)
    def set_planner_settings(
        body: PlannerSettings, user: CurrentUser, services: ContainerDep
    ):
        return services.repository.set_planner_settings(user.uid, body)

    @app.get("/v1/privacy", response_model=PrivacySettings)
    def get_privacy(user: CurrentUser, services: ContainerDep):
        return services.repository.get_privacy(user.uid)

    @app.put("/v1/privacy", response_model=PrivacySettings)
    def set_privacy(body: PrivacySettings, user: CurrentUser, services: ContainerDep):
        previous = services.repository.get_privacy(user.uid)
        if not body.ai_enabled:
            body = body.model_copy(update={
                "indexed_entity_types": [], "index_attachments": False,
                "retain_chat": False, "chat_retention_days": 0,
            })
        result = services.repository.set_privacy(user.uid, body)
        if not body.ai_enabled:
            services.indexing.delete_user_index(user.uid)
        else:
            for entity_type in set(previous.indexed_entity_types) - set(body.indexed_entity_types):
                services.vector_store.delete_entity_type(user.uid, entity_type)
        if not body.retain_chat:
            services.repository.delete_chats(user.uid)
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

    @app.delete("/v1/index/{entity_type}/{record_id}", status_code=204)
    def delete_index_record(
        entity_type: EntityType, record_id: str, user: CurrentUser, services: ContainerDep,
    ) -> Response:
        services.vector_store.delete_record(user.uid, entity_type, record_id)
        services.audit.record(user.uid, "deletion", metadata={
            "entity_type": entity_type.value, "index_only": True,
        })
        return Response(status_code=204)

    @app.post("/v1/copilot/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, user: CurrentUser, services: ContainerDep):
        privacy = services.repository.get_privacy(user.uid)
        if privacy.retain_chat:
            retained = services.repository.get_chat_response(user.uid, body.request_id)
            if retained:
                return retained
        try:
            services.rate_limiter.check(user.uid)
        except RateLimitExceeded as exc:
            services.audit.record(
                user.uid, "rate_limited", outcome="denied",
                metadata={
                    "endpoint": "copilot_chat",
                    "retry_after_seconds": exc.retry_after_seconds,
                },
            )
            raise
        try:
            answer, citations, disclosure, generated = services.copilot.answer(user.uid, body.message)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        proposals: list[ActionProposal] = []
        if generated.action:
            proposal = services.proposals.from_generated_action(user.uid, generated.action, answer)
            if proposal:
                proposals.append(proposal)
        response = ChatResponse(
            answer=answer, citations=citations, retrieval=disclosure, proposals=proposals
        )
        if privacy.retain_chat and privacy.chat_retention_days > 0:
            services.repository.save_chat_response(
                user.uid, body.request_id, body.message, response,
                datetime.now(timezone.utc) + timedelta(days=privacy.chat_retention_days),
            )
        return response

    @app.delete("/v1/chats", status_code=200)
    def delete_chats(user: CurrentUser, services: ContainerDep):
        deleted = services.repository.delete_chats(user.uid)
        services.audit.record(user.uid, "deletion", metadata={"chat_exchanges": deleted})
        return {"deleted": deleted}

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
            services.audit.record(user.uid, "failure", "denied", {
                "stage": "mcp", "error_type": type(exc).__name__,
            })
            return JSONResponse(status_code=403, content={
                "jsonrpc": "2.0", "id": body.id,
                "error": {"code": -32001, "message": str(exc)},
            })

    return app


app = create_app()
