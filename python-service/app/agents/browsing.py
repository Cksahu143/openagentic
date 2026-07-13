"""Browsing agent: for goals that named a specific URL needing JS rendering
(the plain fetch_page tool can't execute JS). Uses the throwaway headless
browser tool — see app/tools/browser.py for why this is deliberately
separate from the JS side's companion (authenticated) browser control."""
from __future__ import annotations

import re

from app.agents.state import AgentState
from app.tools.registry import registry

_URL_RE = re.compile(r"https?://\S+")


async def browsing_node(state: AgentState) -> dict:
    match = _URL_RE.search(state["goal"])
    if not match:
        return {
            "reasoning": "No URL found in the goal for the browsing agent to visit.",
            "next_agent": "finish",
            "timeline": [
                {"label": "Browsing skipped", "kind": "error", "payload": {"reason": "no URL in goal"}}
            ],
        }

    url = match.group(0).rstrip(").,")
    result = await registry.execute(
        "headless_browse",
        {"url": url, "wait_for_selector": None, "screenshot_path": None, "max_chars": 6000},
        granted_permissions={"web_access"},
    )

    return {
        "reasoning": f"Visited {url} (ok={result.ok})",
        "next_agent": "finish",
        "tool_history": [{"tool": "headless_browse", "ok": result.ok, "error": result.error}],
        "timeline": [
            {
                "label": "Headless page visited",
                "kind": "tool_result",
                "payload": {"url": url, "ok": result.ok, "title": (result.output or {}).get("title")},
            }
        ],
    }
