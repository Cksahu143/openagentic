"""
Headless browser tool via Playwright — for research on pages that need JS
rendering (fetch_page in tools/web.py is plain HTTP + BeautifulSoup, which
can't run JS).

IMPORTANT — this is a separate, throwaway, unauthenticated browser
instance. It carries no cookies/session from the user's real browser. It is
NOT a replacement for the companion Chrome extension on the JS side, which
controls the user's actual logged-in browser tab. Do not use this tool for
anything requiring login — it can't do that, and shouldn't be extended to
try (credentials would have to be typed into a bot-visible headless
instance instead of the user's own authenticated session).

Each call launches and tears down its own browser — no persistent browser
process is kept running between calls, trading some latency for a much
simpler resource-cleanup story.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import get_logger
from app.tools.registry import registry

logger = get_logger("tools.browser")


class HeadlessBrowseInput(BaseModel):
    url: str = Field(..., description="Absolute http(s) URL to load")
    wait_for_selector: str | None = Field(
        None, description="Optional CSS selector to wait for before extracting content"
    )
    screenshot_path: str | None = Field(
        None, description="If set, save a PNG screenshot to this absolute path"
    )
    max_chars: int = Field(8000, ge=100, le=50_000)


@registry.register(
    "headless_browse",
    "Load a URL in a real (headless, JS-rendering) browser and extract text — "
    "for pages that plain HTTP fetch can't render. No login/cookies. Not for "
    "authenticated sites; use the companion browser tools for those.",
    HeadlessBrowseInput,
    requires_permission="web_access",
    timeout_s=30,
    max_retries=1,
)
async def headless_browse(
    url: str,
    wait_for_selector: str | None,
    screenshot_path: str | None,
    max_chars: int,
) -> dict:
    settings = get_settings()
    if not settings.playwright_enabled:
        raise RuntimeError("Headless browsing is disabled (PLAYWRIGHT_ENABLED=false)")

    if not url.startswith(("http://", "https://")):
        raise ValueError("Only http/https URLs are allowed")

    # Imported lazily so the rest of the service works even if the
    # `playwright install chromium` step hasn't been run yet.
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            page.set_default_navigation_timeout(settings.playwright_navigation_timeout_ms)
            await page.goto(url, wait_until="domcontentloaded")

            if wait_for_selector:
                await page.wait_for_selector(wait_for_selector, timeout=10_000)

            title = await page.title()
            text = await page.inner_text("body")
            text = " ".join(text.split())

            if screenshot_path:
                await page.screenshot(path=screenshot_path, full_page=True)

            return {
                "url": page.url,
                "title": title,
                "text": text[:max_chars],
                "truncated": len(text) > max_chars,
                "screenshot_path": screenshot_path,
            }
        finally:
            await browser.close()
