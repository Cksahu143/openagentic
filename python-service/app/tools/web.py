"""
Web research tools. These are deliberately read-only HTTP fetch + parse —
NOT a second browser-automation stack. Real-browser control (clicking,
filling forms, logging in) already exists and stays on the JS side via the
companion Chrome extension, which controls the user's actual authenticated
browser. Duplicating that with Playwright/Browser-Use here would run a
second, unauthenticated headless browser with none of that context, so it's
intentionally out of scope for this service.
"""
from __future__ import annotations

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from app.tools.registry import registry


class FetchPageInput(BaseModel):
    url: str = Field(..., description="Absolute URL to fetch")
    max_chars: int = Field(8000, ge=100, le=50_000)


class WebSearchInput(BaseModel):
    query: str = Field(..., min_length=1, max_length=400)
    max_results: int = Field(5, ge=1, le=10)


@registry.register(
    name="fetch_page",
    description="Fetch a URL and return readable text content (SSRF-guarded, GET only).",
    input_model=FetchPageInput,
    requires_permission="web_access",
    timeout_s=15,
)
async def fetch_page(url: str, max_chars: int) -> dict:
    _assert_public_http_url(url)
    async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
        resp = await client.get(url, headers={"User-Agent": "OpenAgent-ResearchAgent/1.0"})
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    return {
        "url": str(resp.url),
        "status": resp.status_code,
        "title": soup.title.string.strip() if soup.title and soup.title.string else None,
        "text": text[:max_chars],
        "truncated": len(text) > max_chars,
    }


def _assert_public_http_url(url: str) -> None:
    """Minimal SSRF guard, mirroring the intent of the TS side's
    browser-fetch.server.ts (which the JS agent already uses for this)."""
    import ipaddress
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http/https URLs are allowed")
    host = parsed.hostname or ""
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("Fetching private/internal addresses is not allowed")
    except ValueError as exc:
        if "does not appear to be an IPv4 or IPv6 address" not in str(exc):
            raise
        # hostname (not a raw IP) — fine, DNS resolution happens at request time
    if host in ("localhost",):
        raise ValueError("Fetching localhost is not allowed")
