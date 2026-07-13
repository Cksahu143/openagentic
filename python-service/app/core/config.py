"""
Central configuration for the OpenAgent Python service.

Mirrors the naming style already used in the TS app's .env (SUPABASE_URL,
SUPABASE_PUBLISHABLE_KEY, etc.) so both services can share one .env file in
local dev if desired — this service simply ignores keys it doesn't need.
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Service identity / bridge auth -----------------------------------
    service_name: str = "openagent-python-service"
    environment: Literal["development", "production", "test"] = "development"
    host: str = "0.0.0.0"
    port: int = 8000

    # Shared secret the TS bridge (src/lib/python-bridge.server.ts) must send
    # as `X-OpenAgent-Bridge-Token`. Generate with `openssl rand -hex 32`.
    bridge_shared_secret: str = Field(default="dev-only-change-me")

    # --- Model providers -----------------------------------------------
    # Reuses the same Lovable AI Gateway the TS side already talks to, so
    # BYO-key behavior stays consistent across both services. Falls back to
    # direct provider keys if set.
    lovable_api_key: str | None = None
    lovable_gateway_base_url: str = "https://ai.gateway.lovable.dev/v1"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    google_api_key: str | None = None

    default_model: str = "google/gemini-3-flash-preview"

    # --- Supabase (service role, server-only) -----------------------------
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None

    # --- Memory / vector store ---------------------------------------------
    chroma_persist_dir: str = "./data/chroma"
    embedding_model: str = "text-embedding-3-small"

    # --- Tooling -------------------------------------------------------
    tool_default_timeout_s: float = 30.0
    tool_max_retries: int = 2

    # --- Agent workspace (per user/session scratch directory) --------------
    workspace_root: str = "./data/workspaces"
    workspace_max_file_bytes: int = 5_000_000

    # --- Headless browser (Playwright) --------------------------------
    # Separate from the JS side's companion Chrome extension, which
    # controls the user's real authenticated browser. This is a throwaway
    # headless instance for research-only page reads — no login, no
    # cookies carried over. See docs/PYTHON_SERVICE.md.
    playwright_enabled: bool = True
    playwright_navigation_timeout_ms: int = 15_000

    # --- Agent's own persistent browser (separate from headless_browse's
    # throwaway instances, and separate from the JS side's companion
    # extension which controls the user's real browser) --------------------
    agent_browser_profile_root: str = "./data/browser_profiles"

    # --- CORS ------------------------------------------------------------
    allowed_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
