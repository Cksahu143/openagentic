import shutil

import pytest

from app.workspace.manager import Workspace, WorkspaceError


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.get_settings(), "workspace_root", str(tmp_path))
    workspace = Workspace("user_1", "session_1")
    yield workspace
    shutil.rmtree(workspace.root, ignore_errors=True)


def test_write_and_read_roundtrip(ws):
    ws.write_text("notes/plan.md", "# plan")
    result = ws.read_text("notes/plan.md")
    assert result["text"] == "# plan"


def test_list_files(ws):
    ws.write_text("a.txt", "1")
    ws.write_text("sub/b.txt", "2")
    files = {f["path"] for f in ws.list_files()}
    assert files == {"a.txt", "sub/b.txt"}


def test_delete_file(ws):
    ws.write_text("a.txt", "1")
    ws.delete("a.txt")
    assert ws.list_files() == []


def test_path_traversal_rejected(ws):
    with pytest.raises(WorkspaceError):
        ws.resolve("../../etc/passwd")


def test_invalid_ids_rejected(tmp_path):
    with pytest.raises(WorkspaceError):
        Workspace("bad id with spaces", "session_1")
