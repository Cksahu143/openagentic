from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger

# Side-effect imports: importing these modules registers their tools with
# the global registry (see app/tools/registry.py). Add new tool modules
# here — this is the ONLY place that needs to change to add a tool.
from app.tools import agent_browser, browser, code_exec, documents, web, workspace  # noqa: F401
from app.tools.registry import registry

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.environment)
    logger.info(
        "service_starting",
        environment=settings.environment,
        tools=[t["name"] for t in registry.list_tools()],
    )
    yield
    from app.browser.manager import _contexts

    for user_id in list(_contexts.keys()):
        from app.browser.manager import close_context

        await close_context(user_id)
    logger.info("service_shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="OpenAgent Python Service",
        description="Multi-agent backend (LangGraph) providing capabilities the "
        "JS side deliberately doesn't duplicate: Python-native data/document "
        "tooling and semantic long-term memory.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
