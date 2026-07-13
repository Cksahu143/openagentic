"""
Shared state passed between agents in the LangGraph graph.

Deliberately mirrors the shape of the JS side's `agent_sessions` row
(task_tree, tool_history, timeline, reasoning) so results can eventually be
written back into the same Supabase table by the bridge, instead of the two
systems inventing separate vocabularies for "what happened in this run."
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class TimelineEvent(TypedDict):
    label: str
    kind: str  # "reasoning" | "tool_call" | "tool_result" | "handoff" | "error"
    payload: dict[str, Any]


class AgentState(TypedDict):
    goal: str
    user_id: str
    session_id: str
    next_agent: str
    reasoning: str
    plan: list[str]
    tool_history: Annotated[list[dict[str, Any]], operator.add]
    timeline: Annotated[list[TimelineEvent], operator.add]
    workspace_files: list[str]
    result: str | None
    done: bool
