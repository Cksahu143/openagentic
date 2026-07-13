"""File agent: inspects the session's workspace and summarizes what's there
relative to the goal — e.g. after a coding step wrote output files, or
before a step that needs to read a previously-downloaded document."""
from __future__ import annotations

from app.agents.state import AgentState
from app.tools.registry import registry


async def file_node(state: AgentState) -> dict:
    listing = await registry.execute(
        "workspace_list_files",
        {"user_id": state["user_id"], "session_id": state["session_id"], "subdir": "."},
        granted_permissions={"workspace"},
    )
    files = (listing.output or {}).get("files", []) if listing.ok else []
    file_names = [f["path"] for f in files]

    return {
        "workspace_files": file_names,
        "reasoning": f"Workspace contains {len(file_names)} file(s): {', '.join(file_names) or '(empty)'}",
        "next_agent": "finish",
        "timeline": [
            {
                "label": "Workspace inspected",
                "kind": "tool_result",
                "payload": {"files": file_names},
            }
        ],
    }
