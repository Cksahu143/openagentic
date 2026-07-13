from __future__ import annotations

from fastapi import APIRouter, Depends

from app.agents.graph import run_agent_graph
from app.agents.memory_agent import recall, remember
from app.core.logging import get_logger
from app.core.security import verify_bridge_token
from app.schemas import (
    MemoryRecallRequest,
    MemoryRememberRequest,
    RunAgentRequest,
    RunAgentResponse,
    ToolExecuteRequest,
    ToolExecuteResponse,
)
from app.tools.registry import registry
from app.workspace.manager import get_workspace

logger = get_logger("api.routes")

router = APIRouter(dependencies=[Depends(verify_bridge_token)])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/tools")
async def list_tools() -> list[dict]:
    return registry.list_tools()


@router.post("/tools/execute", response_model=ToolExecuteResponse)
async def execute_tool(body: ToolExecuteRequest) -> ToolExecuteResponse:
    result = await registry.execute(
        body.tool, body.input, granted_permissions=set(body.permissions)
    )
    return ToolExecuteResponse(
        ok=result.ok,
        output=result.output,
        error=result.error,
        attempts=result.attempts,
        duration_ms=result.duration_ms,
    )


@router.post("/agent/run", response_model=RunAgentResponse)
async def run_agent(body: RunAgentRequest) -> RunAgentResponse:
    logger.info("agent_run_start", user_id=body.user_id, thread_id=body.thread_id)
    final_state = await run_agent_graph(
        goal=body.goal, user_id=body.user_id, session_id=body.session_id
    )
    return RunAgentResponse(
        session_id=final_state["session_id"],
        result=final_state.get("result") or final_state.get("reasoning"),
        plan=final_state.get("plan", []),
        reasoning=final_state.get("reasoning", ""),
        timeline=final_state.get("timeline", []),
        tool_history=final_state.get("tool_history", []),
        workspace_files=final_state.get("workspace_files", []),
    )


@router.get("/workspace/{user_id}/{session_id}/files")
async def list_workspace_files(user_id: str, session_id: str) -> list[dict]:
    return get_workspace(user_id, session_id).list_files()


@router.post("/memory/recall")
async def memory_recall(body: MemoryRecallRequest) -> list[dict]:
    return await recall(body.user_id, body.query, body.n_results)


@router.post("/memory/remember")
async def memory_remember(body: MemoryRememberRequest) -> dict:
    doc_id = await remember(body.user_id, body.text, body.metadata)
    return {"id": doc_id}
