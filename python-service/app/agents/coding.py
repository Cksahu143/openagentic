"""Coding agent: writes and (optionally) executes a small Python snippet to
satisfy a plan step, via the sandboxed run_python tool."""
from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.state import AgentState
from app.core.models import get_chat_model
from app.tools.registry import registry

_SYSTEM = """You are the Coding specialist. Given a goal and plan, write a short
Python snippet (stdlib only, no filesystem/network access) that accomplishes
the relevant step, if code is genuinely needed. Respond ONLY with the code,
no explanation, no markdown fences."""


async def coding_node(state: AgentState) -> dict:
    model = get_chat_model()
    goal_context = f"Goal: {state['goal']}\nPlan so far: {state['plan']}"
    response = await model.ainvoke(
        [SystemMessage(content=_SYSTEM), HumanMessage(content=goal_context)]
    )
    code = str(response.content).strip().strip("`")

    result = await registry.execute(
        "run_python",
        {
            "code": code,
            "timeout_s": 10,
            "user_id": state["user_id"],
            "session_id": state["session_id"],
        },
        granted_permissions={"code_exec"},
    )

    return {
        "reasoning": f"Executed generated snippet (ok={result.ok})",
        "next_agent": "finish",
        "tool_history": [
            {"tool": "run_python", "ok": result.ok, "output": result.output, "error": result.error}
        ],
        "timeline": [
            {
                "label": "Code executed",
                "kind": "tool_result",
                "payload": {"ok": result.ok, "stderr": (result.output or {}).get("stderr", "")},
            }
        ],
    }
