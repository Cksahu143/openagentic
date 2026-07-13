"""
Tools for the agent's OWN persistent browser (app/browser/manager.py) — as
opposed to `headless_browse` (throwaway, no persistence) or the JS side's
companion extension (controls the user's real browser). These are the ones
that satisfy "open browsers, click, fill forms, manage tabs, screenshot,
upload/download, recover from failures" for a browser that belongs to the
agent itself.

Login (Google or otherwise) is intentionally NOT a tool here — see the
module docstring in app/browser/manager.py for why, and
scripts/login_google.py for the one-time manual flow that actually works.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.browser.manager import close_context, get_or_create_page
from app.tools.registry import registry
from app.workspace.manager import get_workspace


class UserScopedInput(BaseModel):
    user_id: str


class NavigateInput(UserScopedInput):
    url: str
    max_chars: int = Field(6000, ge=100, le=50_000)


class ClickInput(UserScopedInput):
    selector: str


class FillInput(UserScopedInput):
    selector: str
    text: str


class ScreenshotInput(UserScopedInput):
    session_id: str
    filename: str = Field("screenshot.png", description="Saved into the session's workspace")


class UploadInput(UserScopedInput):
    session_id: str
    selector: str
    workspace_path: str = Field(..., description="Path to the file, relative to the workspace root")


class TabsInput(UserScopedInput):
    pass


class NewTabInput(UserScopedInput):
    url: str | None = None


class CloseTabInput(UserScopedInput):
    tab_index: int


@registry.register(
    "agent_browser_navigate",
    "Navigate the agent's own persistent browser to a URL and extract page text. "
    "Reuses the same profile/cookies across calls, so prior logins carry over.",
    NavigateInput,
    requires_permission="agent_browser",
    timeout_s=20,
)
async def agent_browser_navigate(user_id: str, url: str, max_chars: int) -> dict:
    if not url.startswith(("http://", "https://")):
        raise ValueError("Only http/https URLs are allowed")
    page = await get_or_create_page(user_id)
    await page.goto(url, wait_until="domcontentloaded")
    title = await page.title()
    text = " ".join((await page.inner_text("body")).split())
    return {
        "url": page.url,
        "title": title,
        "text": text[:max_chars],
        "truncated": len(text) > max_chars,
    }


@registry.register(
    "agent_browser_click",
    "Click an element (CSS selector) in the agent's own browser's current page.",
    ClickInput,
    requires_permission="agent_browser",
    timeout_s=15,
)
async def agent_browser_click(user_id: str, selector: str) -> dict:
    page = await get_or_create_page(user_id)
    await page.click(selector, timeout=10_000)
    return {"clicked": selector, "url": page.url}


@registry.register(
    "agent_browser_fill",
    "Fill a form field (CSS selector) in the agent's own browser's current page.",
    FillInput,
    requires_permission="agent_browser",
    timeout_s=15,
)
async def agent_browser_fill(user_id: str, selector: str, text: str) -> dict:
    page = await get_or_create_page(user_id)
    await page.fill(selector, text, timeout=10_000)
    return {"filled": selector}


@registry.register(
    "agent_browser_screenshot",
    "Screenshot the agent's own browser's current page into the given session's workspace.",
    ScreenshotInput,
    requires_permission="agent_browser",
    timeout_s=15,
)
async def agent_browser_screenshot(user_id: str, session_id: str, filename: str) -> dict:
    page = await get_or_create_page(user_id)
    ws = get_workspace(user_id, session_id)
    abs_path = ws.absolute_path(f"screenshots/{filename}")
    await page.screenshot(path=abs_path, full_page=True)
    return {"path": f"screenshots/{filename}"}


@registry.register(
    "agent_browser_upload_file",
    "Upload a file (already in the session's workspace) via a file input selector "
    "in the agent's own browser's current page.",
    UploadInput,
    requires_permission="agent_browser",
    timeout_s=20,
)
async def agent_browser_upload_file(
    user_id: str, session_id: str, selector: str, workspace_path: str
) -> dict:
    ws = get_workspace(user_id, session_id)
    abs_path = ws.resolve(workspace_path)
    if not abs_path.is_file():
        raise ValueError(f"No such file in workspace: {workspace_path}")
    page = await get_or_create_page(user_id)
    await page.set_input_files(selector, str(abs_path))
    return {"uploaded": workspace_path, "selector": selector}


@registry.register(
    "agent_browser_list_tabs",
    "List open tabs (URL + title) in the agent's own browser.",
    TabsInput,
    requires_permission="agent_browser",
    timeout_s=10,
)
async def agent_browser_list_tabs(user_id: str) -> dict:
    from app.browser.manager import get_or_create_context

    context = await get_or_create_context(user_id)
    tabs = []
    for i, page in enumerate(context.pages):
        tabs.append({"index": i, "url": page.url, "title": await page.title()})
    return {"tabs": tabs}


@registry.register(
    "agent_browser_new_tab",
    "Open a new tab in the agent's own browser, optionally navigating it immediately.",
    NewTabInput,
    requires_permission="agent_browser",
    timeout_s=15,
)
async def agent_browser_new_tab(user_id: str, url: str | None) -> dict:
    from app.browser.manager import get_or_create_context

    context = await get_or_create_context(user_id)
    page = await context.new_page()
    if url:
        await page.goto(url, wait_until="domcontentloaded")
    return {"tab_index": len(context.pages) - 1, "url": page.url}


@registry.register(
    "agent_browser_close_tab",
    "Close a specific tab (by index from agent_browser_list_tabs) in the agent's own browser.",
    CloseTabInput,
    requires_permission="agent_browser",
    timeout_s=10,
)
async def agent_browser_close_tab(user_id: str, tab_index: int) -> dict:
    from app.browser.manager import get_or_create_context

    context = await get_or_create_context(user_id)
    if not (0 <= tab_index < len(context.pages)):
        raise ValueError(f"No tab at index {tab_index}")
    await context.pages[tab_index].close()
    return {"closed_tab_index": tab_index}


@registry.register(
    "agent_browser_close_session",
    "Fully close the agent's browser (frees memory). The on-disk profile/login state "
    "is kept — the next navigate call relaunches from the same saved cookies.",
    UserScopedInput,
    requires_permission="agent_browser",
    timeout_s=10,
)
async def agent_browser_close_session(user_id: str) -> dict:
    closed = await close_context(user_id)
    return {"closed": closed}
