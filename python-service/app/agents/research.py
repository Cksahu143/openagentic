"""Research agent: answers information-gathering steps using the fetch_page
tool, then hands control back to the planner to decide the next step."""
from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.state import AgentState
from app.core.models import get_chat_model
from app.tools.registry import registry

_SYSTEM = """You are the Research specialist. You were handed a goal and a plan.
Summarize what's needed and, if a URL is relevant, note it — the caller will
fetch pages via the fetch_page tool separately. Respond in 2-4 sentences."""


async def research_node(state: AgentState) -> dict:
    model = get_chat_model()
    goal_context = f"Goal: {state['goal']}\nPlan so far: {state['plan']}"
    response = await model.ainvoke(
        [SystemMessage(content=_SYSTEM), HumanMessage(content=goal_context)]
    )

    return {
        "reasoning": str(response.content),
        "next_agent": "finish",
        "timeline": [
            {
                "label": "Research step completed",
                "kind": "handoff",
                "payload": {"summary": str(response.content)[:500]},
            }
        ],
    }


async def fetch_and_summarize(url: str, user_id: str) -> dict:
    """Direct tool invocation helper, used by the API layer for a
    single-shot 'research this URL' call outside the full graph."""
    result = await registry.execute("fetch_page", {"url": url}, granted_permissions={"web_access"})
    return {"ok": result.ok, "output": result.output, "error": result.error}
