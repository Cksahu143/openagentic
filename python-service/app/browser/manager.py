"""
The agent's OWN browser — a persistent, per-user Chromium profile the agent
controls directly, independent of the user's real browser. This is a
different thing from:

  - `tools/browser.py`'s `headless_browse`: a throwaway instance, fresh
    profile every call, no persistence.
  - the JS side's companion Chrome extension: controls the USER's real,
    already-logged-in browser tab.

This one is the agent's identity: cookies and login state persist in
`{AGENT_BROWSER_PROFILE_ROOT}/{user_id}/` across calls and across service
restarts, via Playwright's `launch_persistent_context`.

## On Google login specifically

Google actively fingerprints and blocks automated login attempts (typing a
username/password into a Chromium instance under Playwright control) —
this is intentional anti-bot behavior on Google's part, not a bug here, and
scripting around it is unreliable and against Google's ToS. The approach
that actually works: run `python-service/scripts/login_google.py` once,
locally, on a machine with a display. It opens a REAL, VISIBLE (non-headless)
browser window using this same persistent profile, navigates to Google
sign-in, and waits for you to log in by hand — solving any captcha/2FA
yourself. After that, the saved cookies in the profile let the agent's
headless calls stay signed in, the same way your own browser would.

## Process-lifetime note

The live `BrowserContext`/`Page` objects are kept in this process's memory
(`_contexts` below) so consecutive tool calls reuse the same open tab
instead of relaunching a browser every time. Restarting the service loses
the in-memory open page (a fresh one is launched next call) but NOT the
on-disk cookies/profile — you don't need to log in again after a restart.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("browser.manager")

_contexts: dict[str, tuple] = {}  # user_id -> (playwright, context)
_lock = asyncio.Lock()


def _profile_dir(user_id: str) -> Path:
    settings = get_settings()
    safe_id = "".join(c for c in user_id if c.isalnum() or c in "_-") or "default"
    path = Path(settings.agent_browser_profile_root) / safe_id
    path.mkdir(parents=True, exist_ok=True)
    return path


async def get_or_create_context(user_id: str, *, headless: bool = True):
    """Returns a Playwright BrowserContext for this user's persistent
    profile, launching it if not already running in this process."""
    async with _lock:
        existing = _contexts.get(user_id)
        if existing is not None:
            return existing[1]

        from playwright.async_api import async_playwright

        pw = await async_playwright().start()
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(_profile_dir(user_id)),
            headless=headless,
            viewport={"width": 1280, "height": 800},
        )
        _contexts[user_id] = (pw, context)
        logger.info("agent_browser_context_started", user_id=user_id, headless=headless)
        return context


async def get_or_create_page(user_id: str, *, headless: bool = True):
    context = await get_or_create_context(user_id, headless=headless)
    if context.pages:
        return context.pages[0]
    return await context.new_page()


async def close_context(user_id: str) -> bool:
    async with _lock:
        existing = _contexts.pop(user_id, None)
        if existing is None:
            return False
        pw, context = existing
        await context.close()
        await pw.stop()
        logger.info("agent_browser_context_closed", user_id=user_id)
        return True
