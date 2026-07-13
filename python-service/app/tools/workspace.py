"""
Workspace tools: give the agent a real, persistent scratch directory it can
write to, read from, and list — its own workspace per (user, session),
rather than only being able to return text in a response.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.registry import registry
from app.workspace.manager import WorkspaceError, get_workspace


class WorkspaceWriteInput(BaseModel):
    user_id: str
    session_id: str
    path: str = Field(..., description="Path relative to the workspace root")
    content: str


class WorkspaceReadInput(BaseModel):
    user_id: str
    session_id: str
    path: str


class WorkspaceListInput(BaseModel):
    user_id: str
    session_id: str
    subdir: str = "."


class WorkspaceDeleteInput(BaseModel):
    user_id: str
    session_id: str
    path: str


@registry.register(
    "workspace_write_file",
    "Write a file into the agent's own workspace directory for this session.",
    WorkspaceWriteInput,
    requires_permission="workspace",
)
async def workspace_write_file(user_id: str, session_id: str, path: str, content: str) -> dict:
    ws = get_workspace(user_id, session_id)
    try:
        return ws.write_text(path, content)
    except WorkspaceError as e:
        raise ValueError(str(e)) from e


@registry.register(
    "workspace_read_file",
    "Read a file from the agent's own workspace directory for this session.",
    WorkspaceReadInput,
    requires_permission="workspace",
)
async def workspace_read_file(user_id: str, session_id: str, path: str) -> dict:
    ws = get_workspace(user_id, session_id)
    try:
        return ws.read_text(path)
    except WorkspaceError as e:
        raise ValueError(str(e)) from e


@registry.register(
    "workspace_list_files",
    "List files in the agent's workspace directory for this session.",
    WorkspaceListInput,
    requires_permission="workspace",
)
async def workspace_list_files(user_id: str, session_id: str, subdir: str) -> dict:
    ws = get_workspace(user_id, session_id)
    return {"files": ws.list_files(subdir)}


@registry.register(
    "workspace_delete_file",
    "Delete a file or directory from the agent's workspace.",
    WorkspaceDeleteInput,
    requires_permission="workspace",
)
async def workspace_delete_file(user_id: str, session_id: str, path: str) -> dict:
    ws = get_workspace(user_id, session_id)
    try:
        return ws.delete(path)
    except WorkspaceError as e:
        raise ValueError(str(e)) from e
