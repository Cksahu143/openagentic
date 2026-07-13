"""
Planner agent: goal decomposition + routing to a specialist agent.

Equivalent in spirit to the JS side's plan_session/set_reasoning/update_step
tool trio in src/routes/api/chat.ts, but running here as a graph node so it
can hand off to Python-only specialists (research, coding) that need
libraries with no good JS equivalent (pandas/numpy-heavy analysis, PyMuPDF,
etc).
"""
from __future__ import annotations

import json

from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.state import AgentState
from app.core.logging import get_logger
from app.core.models import get_chat_model

logger = get_logger("agents.planner")

_SYSTEM = """You are the Planner for a multi-agent system. Given a goal, decide:
1. A short numbered plan (2-6 steps).
2. Which specialist should take the NEXT step: "research" (plain HTTP page
   reads), "browsing" (JS-rendered pages, needs a real headless browser),
   "coding" (write/run a Python snippet in the shared workspace), "file"
   (read/write/parse files — PDF, DOCX, images — in the shared workspace),
   or "finish".

Respond ONLY as JSON: {"plan": ["step1", "step2"], "next_agent": "research|browsing|coding|file|finish", "reasoning": "one sentence"}"""


async def planner_node(state: AgentState) -> dict:
    model = get_chat_model()
    messages = [SystemMessage(content=_SYSTEM), HumanMessage(content=state["goal"])]
    response = await model.ainvoke(messages)

    try:
        parsed = json.loads(response.content)
        plan = list(parsed.get("plan", []))
        next_agent = parsed.get("next_agent", "finish")
        reasoning = parsed.get("reasoning", "")
    except (json.JSONDecodeError, AttributeError):
        logger.warn("planner_parse_failed", raw=str(response.content)[:200])
        plan, next_agent, reasoning = [], "finish", "Failed to parse plan; ending run."

    return {
        "plan": plan,
        "next_agent": next_agent,
        "reasoning": reasoning,
        "timeline": [{"label": "Plan created", "kind": "reasoning", "payload": {"plan": plan}}],
    }
