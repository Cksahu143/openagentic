from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RunAgentRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=4000)
    user_id: str = Field(..., min_length=1)
    thread_id: str | None = None
    session_id: str | None = Field(
        None, description="Reuse an existing workspace/session; a new one is created if omitted"
    )


class RunAgentResponse(BaseModel):
    session_id: str
    result: str | None
    plan: list[str]
    reasoning: str
    timeline: list[dict[str, Any]]
    tool_history: list[dict[str, Any]]
    workspace_files: list[str]


class ToolExecuteRequest(BaseModel):
    tool: str
    input: dict[str, Any]
    permissions: list[str] = Field(default_factory=list)


class ToolExecuteResponse(BaseModel):
    ok: bool
    output: Any = None
    error: str | None = None
    attempts: int
    duration_ms: float


class MemoryRecallRequest(BaseModel):
    user_id: str
    query: str
    n_results: int = 5


class MemoryRememberRequest(BaseModel):
    user_id: str
    text: str
    metadata: dict[str, Any] | None = None
