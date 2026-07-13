import asyncio

import pytest
from pydantic import BaseModel

from app.tools.registry import ToolRegistry


class EchoInput(BaseModel):
    value: str


@pytest.mark.asyncio
async def test_execute_success():
    reg = ToolRegistry()

    @reg.register("echo", "Echoes input", EchoInput)
    async def echo(value: str) -> str:
        return value

    result = await reg.execute("echo", {"value": "hi"})
    assert result.ok
    assert result.output == "hi"
    assert result.attempts == 1


@pytest.mark.asyncio
async def test_execute_retries_then_succeeds():
    reg = ToolRegistry()
    calls = {"n": 0}

    @reg.register("flaky", "Fails twice then succeeds", EchoInput, max_retries=2, timeout_s=1)
    async def flaky(value: str) -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("not yet")
        return value

    result = await reg.execute("flaky", {"value": "ok"})
    assert result.ok
    assert result.attempts == 3


@pytest.mark.asyncio
async def test_execute_unknown_tool():
    reg = ToolRegistry()
    result = await reg.execute("nope", {})
    assert not result.ok
    assert "Unknown tool" in result.error


@pytest.mark.asyncio
async def test_execute_invalid_input():
    reg = ToolRegistry()

    @reg.register("needs_value", "Requires 'value'", EchoInput)
    async def needs_value(value: str) -> str:
        return value

    result = await reg.execute("needs_value", {"wrong_field": "x"})
    assert not result.ok
    assert "Invalid input" in result.error


@pytest.mark.asyncio
async def test_execute_permission_denied():
    reg = ToolRegistry()

    @reg.register("guarded", "Needs a permission", EchoInput, requires_permission="admin")
    async def guarded(value: str) -> str:
        return value

    result = await reg.execute("guarded", {"value": "x"}, granted_permissions=set())
    assert not result.ok
    assert "Missing permission" in result.error
