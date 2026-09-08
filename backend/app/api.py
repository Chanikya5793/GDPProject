from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .ai import GenerationTimeout
from .auth import CurrentUser
from .config import get_settings
from .models import (
    ActionProposal,
    AiProviderInfo,
    ChatRequest,
    ChatResponse,
    ChatTurn,
    ConfirmProposalRequest,
    Conversation,
    ConversationDetail,
    ConversationMessage,
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
    RenameConversationRequest,
)
from .proposals import InvalidProposal
from .rag import AgentStep
from .ratelimit import RateLimitExceeded
from .repository import IdempotencyConflict, NotFound, RevisionConflict
from .runtime import Container, build_production_container
from .signup_policy import get_signup_policy


class McpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jsonrpc: str = Field(pattern=r"^2\.0$")
    id: Optional[Any] = None
    method: str
    params: Dict[str, Any] = Field(default_factory=dict)


# A streamed response is committed as HTTP 200 the moment the body starts, so
# anything that must surface as a status code has to be settled before then.
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Without this an intermediary is free to buffer the whole body and hand it
    # over at the end, which would deliver the wait it exists to remove.
    "X-Accel-Buffering": "no",
}


def sse_event(event: str, payload: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def _rationale(action) -> str:
    """One line saying what a proposal is, for the card's heading.

    Deliberately mechanical. The card below it already renders every field that
    changes, and the assistant's own prose used to be pressed into this job --
    which meant it had to write prose even when the student had asked for a
    change and wanted nothing said.
    """
    verb = {
        "create": "Add", "update": "Change", "complete": "Complete",
        "reschedule": "Move", "delete": "Delete",
    }.get(action.operation.value, "Change")
    label = (action.title or "").strip()
    kind = action.entity_type.value
    return f"{verb} {kind}: {label}" if label else f"{verb} this {kind}"


def build_chat_response(services: Container, uid: str, answer, citations, disclosure, generated):
    """Turn every change the model asked for into a preview to confirm.

    A request can be plural now: "push all my overdue work to Friday" is one
    proposal per task, each with its own before-and-after, so the student can
    accept some and reject others rather than being handed one bundle.
    """
    proposals: list[ActionProposal] = []
    refusals: list[str] = []
    for action in generated.all_actions():
        # The preview card carries a before-and-after of every field, so the
        # rationale only has to say what kind of change this is. It used to be
        # the whole answer, which is what forced the assistant to write prose
        # even when the card said it all.
        prepared = services.proposals.prepare(uid, action, _rationale(action))
        if prepared.proposal:
            proposals.append(prepared.proposal)
        else:
            # It described a change it could not express. Saying only that
            # something failed left the student guessing which change and what
            # was missing, so the reason travels with it.
            label = (action.title or action.record_id or action.entity_type.value).strip()
            refusals.append(f"{label} ({prepared.reason})" if prepared.reason else label)
    return ChatResponse(
        answer=answer, citations=citations, retrieval=disclosure,
        proposals=proposals, unavailable=refusals,
    )


def thread_history(services: Container, uid: str, body, privacy):
    """The turns to replay, from the thread when there is one.

    A named thread is the authority: the client no longer has to carry the
    transcript, and two devices looking at the same thread see the same one.
    Without a thread the client's own history still works, so an older build
    keeps functioning.
    """
    if body.conversation_id and privacy.retain_chat:
        try:
            detail = services.repository.get_conversation(uid, body.conversation_id)
        except NotFound:
            return list(body.history)
        return [ChatTurn(role=m.role, text=m.text) for m in detail.messages][-20:]
    return list(body.history)


def remember_turn(services: Container, uid: str, privacy, body, response) -> ChatResponse:
    """Store the exchange in its thread and tell the client which one.

    Opted out, nothing is written and the thread id the client sent is handed
    straight back, so a device-only conversation still threads locally.
    """
    if not privacy.retain_chat:
        return response.model_copy(update={"conversation_id": body.conversation_id})
    now = datetime.now(timezone.utc)
    detail = services.repository.append_turn(
        uid, body.conversation_id,
        ConversationMessage(role="user", text=body.message[:4000], created_at=now),
        ConversationMessage(
            role="assistant", text=response.answer[:4000],
            citations=response.citations[:40], created_at=now,
        ),
        retention_days=privacy.chat_retention_days,
    )
    return response.model_copy(update={"conversation_id": detail.conversation_id})


# How long a reply stays replayable for its request id. This is not retention:
# the conversation is the history, and keeping a second full copy of every
# exchange for thirty days was storing the same words twice. All this has to
# outlive is a retry.
REPLAY_WINDOW = timedelta(hours=24)


def retain_chat_response(services: Container, uid: str, privacy, body, response) -> None:
    """Keep the answer replayable, so a retried request_id costs no generation."""
    if privacy.retain_chat:
        services.repository.save_chat_response(
            uid, body.request_id, body.message, response,
            datetime.now(timezone.utc) + REPLAY_WINDOW,
        )


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
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
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
            answer, citations, disclosure, generated = services.copilot.answer(
                user.uid, body.message,
                history=thread_history(services, user.uid, body, privacy),
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except GenerationTimeout as exc:
            # Expected under load rather than a fault: say so and let them retry,
            # instead of a bare 500.
            raise HTTPException(
                status_code=504,
                detail="The assistant took too long to answer. Please try again.",
            ) from exc
        response = build_chat_response(
            services, user.uid, answer, citations, disclosure, generated
        )
        response = remember_turn(services, user.uid, privacy, body, response)
        retain_chat_response(services, user.uid, privacy, body, response)
        return response

    @app.post("/v1/copilot/chat/stream")
    def chat_stream(body: ChatRequest, user: CurrentUser, services: ContainerDep):
        """The same answer as /v1/copilot/chat, delivered as it is written.

        Emits `delta` events carrying answer text, `step` events whenever the
        assistant looks something up for itself, and one `final` event with the
        complete ChatResponse. The final event is authoritative: the citation
        guard can replace the answer after generation, so a client must render
        `final.answer` rather than the text it accumulated. A `step` also means
        any text delivered so far belonged to a round the assistant has moved
        past, so the client must clear what it has when one arrives.
        """
        privacy = services.repository.get_privacy(user.uid)
        if privacy.retain_chat:
            retained = services.repository.get_chat_response(user.uid, body.request_id)
            if retained:
                # Already answered. There is nothing left to stream, so send the
                # stored reply as the final event and close.
                return StreamingResponse(
                    iter([sse_event("final", retained.model_dump(mode="json"))]),
                    media_type="text/event-stream", headers=SSE_HEADERS,
                )
        try:
            services.rate_limiter.check(user.uid)
        except RateLimitExceeded as exc:
            services.audit.record(
                user.uid, "rate_limited", outcome="denied",
                metadata={
                    "endpoint": "copilot_chat_stream",
                    "retry_after_seconds": exc.retry_after_seconds,
                },
            )
            raise
        stream = services.copilot.answer_stream(
            user.uid, body.message,
            history=thread_history(services, user.uid, body, privacy),
        )
        # Pull the first item here rather than inside the response body. Once a
        # streaming body starts the status line is already 200, so retrieval
        # being denied or the model timing out could only be reported in-band;
        # priming keeps them as real status codes.
        try:
            first = next(stream)
        except StopIteration as exc:
            raise HTTPException(status_code=500, detail="The assistant produced no answer.") from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except GenerationTimeout as exc:
            raise HTTPException(
                status_code=504,
                detail="The assistant took too long to answer. Please try again.",
            ) from exc

        def events():
            item = first
            while True:
                if isinstance(item, tuple):
                    answer, citations, disclosure, generated = item
                    response = build_chat_response(
                        services, user.uid, answer, citations, disclosure, generated
                    )
                    response = remember_turn(services, user.uid, privacy, body, response)
                    retain_chat_response(services, user.uid, privacy, body, response)
                    yield sse_event("final", response.model_dump(mode="json"))
                    return
                if isinstance(item, AgentStep):
                    yield sse_event("step", {"tool": item.tool, "label": item.label})
                else:
                    yield sse_event("delta", {"text": item})
                try:
                    item = next(stream)
                except StopIteration:
                    return
                except GenerationTimeout:
                    yield sse_event("error", {
                        "code": "timeout",
                        "detail": "The assistant took too long to answer. Please try again.",
                    })
                    return
                except Exception:
                    # The detail is withheld on purpose: it can quote the prompt,
                    # and the prompt carries the student's planner records.
                    yield sse_event("error", {
                        "code": "generation_failed",
                        "detail": "The assistant could not finish that answer.",
                    })
                    return

        return StreamingResponse(
            events(), media_type="text/event-stream", headers=SSE_HEADERS,
        )

    @app.get("/v1/conversations", response_model=list[Conversation])
    def list_conversations(
        user: CurrentUser, services: ContainerDep,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
    ):
        return services.repository.list_conversations(user.uid, limit)

    @app.get("/v1/conversations/{conversation_id}", response_model=ConversationDetail)
    def get_conversation(conversation_id: str, user: CurrentUser, services: ContainerDep):
        return services.repository.get_conversation(user.uid, conversation_id)

    @app.patch("/v1/conversations/{conversation_id}", response_model=Conversation)
    def rename_conversation(
        conversation_id: str, body: RenameConversationRequest,
        user: CurrentUser, services: ContainerDep,
    ):
        return services.repository.rename_conversation(user.uid, conversation_id, body.title)

    @app.delete("/v1/conversations/{conversation_id}", status_code=204)
    def delete_conversation(
        conversation_id: str, user: CurrentUser, services: ContainerDep,
    ) -> Response:
        if not services.repository.delete_conversation(user.uid, conversation_id):
            raise NotFound("Conversation not found")
        services.audit.record(user.uid, "deletion", metadata={"conversations": 1})
        return Response(status_code=204)

    @app.delete("/v1/conversations", status_code=200)
    def delete_conversations(user: CurrentUser, services: ContainerDep):
        deleted = services.repository.delete_conversations(user.uid)
        services.audit.record(user.uid, "deletion", metadata={"conversations": deleted})
        return {"deleted": deleted}

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
