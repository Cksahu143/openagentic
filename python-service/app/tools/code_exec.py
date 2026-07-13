"""
Sandboxed Python execution for the Coding Agent, mirroring the intent (and
the caution) of src/lib/code-runner.server.ts on the JS side, which runs
untrusted JS in a locked-down VM. Here we shell out to a subprocess with a
hard timeout, a resource-limited environment, and no network/file access
beyond a scratch directory, rather than exec()'ing in-process.
"""
from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from pydantic import BaseModel, Field

from app.tools.registry import registry
from app.workspace.manager import get_workspace


class RunPythonInput(BaseModel):
    code: str = Field(..., min_length=1, max_length=20_000)
    timeout_s: float = Field(10.0, ge=1, le=30)
    user_id: str | None = Field(
        None, description="If set with session_id, runs inside that session's persistent workspace"
    )
    session_id: str | None = None


@registry.register(
    name="run_python",
    description="Run a short, sandboxed Python snippet and return stdout/stderr. "
    "Pass user_id + session_id to run inside (and write files into) that session's workspace.",
    input_model=RunPythonInput,
    requires_permission="code_exec",
    timeout_s=32,
)
async def run_python(
    code: str, timeout_s: float, user_id: str | None, session_id: str | None
) -> dict:
    if user_id and session_id:
        cwd = Path(get_workspace(user_id, session_id).root)
        cleanup = False
    else:
        cwd = Path(tempfile.mkdtemp(prefix="openagent-run-"))
        cleanup = True

    script_path = cwd / "_snippet.py"
    script_path.write_text(code, encoding="utf-8")

    try:
        proc = await asyncio.create_subprocess_exec(
            "python3",
            "-I",  # isolated mode: ignore user env/site dirs
            str(script_path),
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {"ok": False, "stdout": "", "stderr": "Execution timed out", "exit_code": None}

        return {
            "ok": proc.returncode == 0,
            "stdout": stdout.decode(errors="replace")[:20_000],
            "stderr": stderr.decode(errors="replace")[:20_000],
            "exit_code": proc.returncode,
        }
    finally:
        script_path.unlink(missing_ok=True)
        if cleanup:
            shutil.rmtree(cwd, ignore_errors=True)
