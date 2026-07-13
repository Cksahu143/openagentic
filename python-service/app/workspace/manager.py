"""
Per-user, per-session workspace: a real directory on disk the agents can
read/write/list files in, analogous to what Manus-style agents call a
"sandbox." This is intentionally simple (local filesystem, path-confined) —
not a container-per-session sandbox. See docs/PYTHON_SERVICE.md for the
production-hardening note (this is fine for a single trusted user/backend,
not for untrusted multi-tenant isolation).

Layout on disk:
  {WORKSPACE_ROOT}/{user_id}/{session_id}/...

All tool-facing paths are relative to the session's workspace root and are
resolved + validated to prevent path traversal outside it.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from app.core.config import get_settings

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")


class WorkspaceError(ValueError):
    pass


def _validate_id(value: str, label: str) -> str:
    if not _SAFE_ID.match(value):
        raise WorkspaceError(f"Invalid {label}: must be alphanumeric/underscore/hyphen")
    return value


class Workspace:
    def __init__(self, user_id: str, session_id: str):
        settings = get_settings()
        self.user_id = _validate_id(user_id, "user_id")
        self.session_id = _validate_id(session_id, "session_id")
        self.root = Path(settings.workspace_root) / self.user_id / self.session_id
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, relative_path: str) -> Path:
        """Resolve a tool-provided relative path, refusing anything that
        would escape the workspace root."""
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root.resolve())
        except ValueError:
            raise WorkspaceError(f"Path escapes workspace: {relative_path}") from None
        return candidate

    def write_text(self, relative_path: str, content: str, max_bytes: int = 5_000_000) -> dict:
        if len(content.encode("utf-8")) > max_bytes:
            raise WorkspaceError(f"File exceeds max size of {max_bytes} bytes")
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {"path": relative_path, "bytes": len(content.encode("utf-8"))}

    def read_text(self, relative_path: str, max_chars: int = 200_000) -> dict:
        path = self.resolve(relative_path)
        if not path.is_file():
            raise WorkspaceError(f"No such file: {relative_path}")
        text = path.read_text(encoding="utf-8", errors="replace")
        return {"path": relative_path, "text": text[:max_chars], "truncated": len(text) > max_chars}

    def delete(self, relative_path: str) -> dict:
        path = self.resolve(relative_path)
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
        else:
            raise WorkspaceError(f"No such path: {relative_path}")
        return {"deleted": relative_path}

    def list_files(self, subdir: str = ".") -> list[dict]:
        base = self.resolve(subdir)
        if not base.exists():
            return []
        out = []
        for p in sorted(base.rglob("*")):
            if p.is_file():
                out.append(
                    {
                        "path": str(p.relative_to(self.root)),
                        "bytes": p.stat().st_size,
                    }
                )
        return out

    def absolute_path(self, relative_path: str) -> str:
        """For tools (e.g. run_python, playwright) that need a real
        filesystem path to write outputs to, rather than text content."""
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return str(path)


def get_workspace(user_id: str, session_id: str) -> Workspace:
    return Workspace(user_id, session_id)
