#!/usr/bin/env bash
# One-command dev launcher: Python agent service + TS app, both from your
# already-filled-in .env files. Run this from the project root:
#   chmod +x run.sh && ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== Python service: venv + deps =="
if ! command -v python3.12 >/dev/null 2>&1; then
  echo "python3.12 not found. Install it first: brew install python@3.12"
  exit 1
fi
if [[ ! -f python-service/.venv/bin/activate ]]; then
  rm -rf python-service/.venv
  python3.12 -m venv python-service/.venv
fi
source python-service/.venv/bin/activate
pip install -q -r python-service/requirements.txt
python -m playwright install chromium --with-deps 2>/dev/null || python -m playwright install chromium

echo "== Python service: starting on :8000 =="
(cd python-service && uvicorn app.main:app --host 0.0.0.0 --port 8000 &)
PY_PID=$!

echo "== TS app: deps =="
if command -v bun >/dev/null 2>&1; then PKG=bun; else PKG=npm; fi
$PKG install

echo "== TS app: starting on :3000 =="
trap 'kill $PY_PID 2>/dev/null || true' EXIT
$PKG run dev
