"""
Run this once, locally, on a machine with a display, to sign the agent's
OWN persistent browser into Google (or any other site).

Why this is a script you run by hand instead of a tool the agent calls
itself: Google (and most sites with real security) detects and blocks
automated login attempts — typing credentials into a Playwright-controlled
browser is unreliable and against most sites' ToS. What actually works is
a real human solving the login/captcha/2FA once, in a REAL VISIBLE browser
window, after which the session cookies are saved to disk and every future
headless call from the agent reuses them — exactly like staying logged into
your own browser.

Usage:
    cd python-service
    source .venv/bin/activate
    python scripts/login_google.py YOUR_USER_ID
    # (YOUR_USER_ID should match the Supabase user id the TS app will pass
    #  as `user_id` when calling the bridge — check your Supabase Auth users
    #  table, or just use a fixed id like "default" for local single-user use.)

A Chromium window opens. Log in normally. Close the window (or press Enter
in the terminal) once you're done — the profile is saved automatically to
AGENT_BROWSER_PROFILE_ROOT/<user_id>/ and persists across restarts.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings  # noqa: E402


async def main(user_id: str, start_url: str) -> None:
    from playwright.async_api import async_playwright

    settings = get_settings()
    profile_dir = Path(settings.agent_browser_profile_root) / user_id
    profile_dir.mkdir(parents=True, exist_ok=True)

    print(f"Opening a visible browser window using profile: {profile_dir}")
    print("Log in normally in the window that opens. Press Enter here when done.")

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(start_url)

        await asyncio.get_event_loop().run_in_executor(None, input, "")

        await context.close()
    print(f"Done. Session saved to {profile_dir} — the agent's headless calls will reuse it.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/login_google.py <user_id> [start_url]")
        sys.exit(1)
    user_id_arg = sys.argv[1]
    url_arg = sys.argv[2] if len(sys.argv) > 2 else "https://accounts.google.com/signin"
    asyncio.run(main(user_id_arg, url_arg))
