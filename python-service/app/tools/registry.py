"""
Universal tool system for the Python agents.

Design goals (matching the JS side's plugin/permission model in
src/modules and supabase `installed_plugins` table):
  - Tools register themselves by decorating a function; no central file
    needs editing to add a new tool.
  - Each tool declares a Pydantic input schema for validation.
  - Execution is wrapped with a timeout + bounded retries with backoff,
    matching the recovery caps already used by the companion browser tools
    on the TS side (record_recovery: max 4/step, exponential backoff).
  - Tools can be discovered at runtime (list + JSON schema) so the planner
    or an external caller (e.g. a future plugin marketplace, per M13 on the
    JS roadmap) can enumerate what's available without hardcoding names.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("tools.registry")

ToolFunc = Callable[..., Awaitable[Any]]


@dataclass
class ToolSpec:
    name: str
    description: str
    input_model: type[BaseModel]
    func: ToolFunc
    version: str = "1.0.0"
    requires_permission: str | None = None  # e.g. "web_access", "code_exec"
    timeout_s: float | None = None
    max_retries: int | None = None

    def json_schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "requires_permission": self.requires_permission,
            "parameters": self.input_model.model_json_schema(),
        }


@dataclass
class ToolResult:
    ok: bool
    output: Any = None
    error: str | None = None
    attempts: int = 1
    duration_ms: float = 0.0


class ToolRegistry:
    """Process-wide registry. Import `registry` singleton below."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(
        self,
        name: str,
        description: str,
        input_model: type[BaseModel],
        *,
        version: str = "1.0.0",
        requires_permission: str | None = None,
        timeout_s: float | None = None,
        max_retries: int | None = None,
    ) -> Callable[[ToolFunc], ToolFunc]:
        def decorator(func: ToolFunc) -> ToolFunc:
            if name in self._tools:
                raise ValueError(f"Tool '{name}' is already registered")
            self._tools[name] = ToolSpec(
                name=name,
                description=description,
                input_model=input_model,
                func=func,
                version=version,
                requires_permission=requires_permission,
                timeout_s=timeout_s,
                max_retries=max_retries,
            )
            logger.info("tool_registered", tool=name, version=version)
            return func

        return decorator

    def list_tools(self) -> list[dict[str, Any]]:
        return [spec.json_schema() for spec in self._tools.values()]

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    async def execute(
        self,
        name: str,
        raw_input: dict[str, Any],
        *,
        granted_permissions: set[str] | None = None,
    ) -> ToolResult:
        settings = get_settings()
        spec = self._tools.get(name)
        if spec is None:
            return ToolResult(ok=False, error=f"Unknown tool: {name}")

        if spec.requires_permission and granted_permissions is not None:
            if spec.requires_permission not in granted_permissions:
                return ToolResult(
                    ok=False,
                    error=f"Missing permission '{spec.requires_permission}' for tool '{name}'",
                )

        try:
            validated = spec.input_model.model_validate(raw_input)
        except Exception as exc:  # pydantic ValidationError
            return ToolResult(ok=False, error=f"Invalid input: {exc}")

        timeout_s = spec.timeout_s or settings.tool_default_timeout_s
        max_retries = spec.max_retries if spec.max_retries is not None else settings.tool_max_retries

        started = time.monotonic()
        last_error: str | None = None

        for attempt in range(1, max_retries + 2):  # first try + retries
            try:
                output = await asyncio.wait_for(
                    spec.func(**validated.model_dump()), timeout=timeout_s
                )
                duration_ms = (time.monotonic() - started) * 1000
                logger.info(
                    "tool_executed", tool=name, attempt=attempt, duration_ms=round(duration_ms, 1)
                )
                return ToolResult(ok=True, output=output, attempts=attempt, duration_ms=duration_ms)
            except asyncio.TimeoutError:
                last_error = f"Timed out after {timeout_s}s"
            except Exception as exc:  # noqa: BLE001 - tool errors are data, not crashes
                last_error = str(exc)

            logger.warn("tool_attempt_failed", tool=name, attempt=attempt, error=last_error)
            if attempt <= max_retries:
                backoff = min(0.4 * (2 ** (attempt - 1)), 5.0)
                await asyncio.sleep(backoff)

        duration_ms = (time.monotonic() - started) * 1000
        return ToolResult(
            ok=False, error=last_error, attempts=max_retries + 1, duration_ms=duration_ms
        )


registry = ToolRegistry()
