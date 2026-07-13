"""
Multi-agent orchestration graph.

    planner -> {research | browsing | coding | file | finish}
    research/browsing/coding/file -> planner   (re-plan; capped by MAX_HOPS)
    finish -> END

This is a small, explicit graph rather than a fully autonomous swarm —
matching this project's existing philosophy (see KNOWN_LIMITATIONS.md on the
JS side: "Retry logic is model-driven, not deterministic" is called out as a
limitation, not a feature to imitate). Hops are hard-capped in code, not
left to the model's discretion.
"""
from __future__ import annotations

import uuid

from langgraph.graph import END, StateGraph

from app.agents.browsing import browsing_node
from app.agents.coding import coding_node
from app.agents.file import file_node
from app.agents.planner import planner_node
from app.agents.research import research_node
from app.agents.state import AgentState
from app.core.logging import get_logger

logger = get_logger("agents.graph")

MAX_HOPS = 6
_SPECIALISTS = {"research", "browsing", "coding", "file"}


def _route(state: AgentState) -> str:
    if state.get("done"):
        return "finish"
    hops = len(state.get("timeline", []))
    if hops >= MAX_HOPS:
        logger.warn("graph_hop_cap_reached", hops=hops)
        return "finish"
    next_agent = state.get("next_agent", "finish")
    return next_agent if next_agent in _SPECIALISTS else "finish"


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("planner", planner_node)
    graph.add_node("research", research_node)
    graph.add_node("browsing", browsing_node)
    graph.add_node("coding", coding_node)
    graph.add_node("file", file_node)

    routing_map = {
        "research": "research",
        "browsing": "browsing",
        "coding": "coding",
        "file": "file",
        "finish": END,
    }

    graph.set_entry_point("planner")
    graph.add_conditional_edges("planner", _route, routing_map)
    graph.add_conditional_edges("research", _route, routing_map)
    graph.add_conditional_edges("browsing", _route, routing_map)
    graph.add_conditional_edges("coding", _route, routing_map)
    graph.add_conditional_edges("file", _route, routing_map)

    return graph.compile()


_compiled = None


def get_compiled_graph():
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    return _compiled


async def run_agent_graph(goal: str, user_id: str, session_id: str | None = None) -> AgentState:
    initial: AgentState = {
        "goal": goal,
        "user_id": user_id,
        "session_id": session_id or str(uuid.uuid4()),
        "next_agent": "planner",
        "reasoning": "",
        "plan": [],
        "tool_history": [],
        "timeline": [],
        "workspace_files": [],
        "result": None,
        "done": False,
    }
    graph = get_compiled_graph()
    final_state: AgentState = await graph.ainvoke(initial)
    return final_state
