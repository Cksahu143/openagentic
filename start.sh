#!/usr/bin/env bash
# One-command start for OpenAgent: sets up and runs BOTH the TS app and the
# Python multi-agent service. Safe to re-run — skips steps already done.
#
# Usage:
#   ./start.sh
# (On Mac, you can also double-click start.command — see that file.)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PY_DIR="python-service"
PY_PID=""

cleanup() {
  if [[ -n "$PY_PID" ]] && kill -0 "$PY_PID" 2>/dev/null; then
    echo ""
    echo "Stopping Python service (pid $PY_PID)..."
    kill "$PY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "== 1/5  Python service: virtualenv =="
if [[ ! -d "$PY_DIR/.venv" ]]; then
  python3 -m venv "$PY_DIR/.venv"
fi
# shellcheck disable=SC1091
source "$PY_DIR/.venv/bin/activate"

echo "== 2/5  Python service: dependencies =="
MARKER="$PY_DIR/.venv/.deps-installed"
if [[ ! -f "$MARKER" ]] || [[ "$PY_DIR/requirements.txt" -nt "$MARKER" ]]; then
  pip install --quiet --upgrade pip
  pip install --quiet -r "$PY_DIR/requirements.txt"
  touch "$MARKER"
else
  echo "  (already installed, skipping)"
fi

echo "== 3/5  Python service: headless browser binary =="
BROWSER_MARKER="$PY_DIR/.venv/.playwright-installed"
if [[ ! -f "$BROWSER_MARKER" ]]; then
  python -m playwright install chromium
  touch "$BROWSER_MARKER"
else
  echo "  (already installed, skipping)"
fi

echo "== 4/5  Python service: starting on :8000 =="
mkdir -p "$PY_DIR/data" logs
(
  cd "$PY_DIR"
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000
) > logs/python-service.log 2>&1 &
PY_PID=$!
echo "  started (pid $PY_PID), logs: logs/python-service.log"

# Wait for it to come up before starting the TS app (max ~15s)
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:8000/api/v1/health" -H "X-OpenAgent-Bridge-Token: $(grep BRIDGE_SHARED_SECRET $PY_DIR/.env | cut -d= -f2)" >/dev/null 2>&1; then
    echo "  healthy"
    break
  fi
  sleep 0.5
done

echo "== 5/5  TS app: dependencies + dev server =="
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if command -v bun >/dev/null 2>&1 && [[ -f bun.lock ]]; then
  [[ -d node_modules ]] || bun install
  echo ""
  echo "Starting the app — the URL to open will be printed below by Vite."
  echo "(Python service is running in the background; its logs are in logs/python-service.log)"
  echo ""
  bun run dev
else
  [[ -d node_modules ]] || npm install
  echo ""
  echo "Starting the app — the URL to open will be printed below by Vite."
  echo "(Python service is running in the background; its logs are in logs/python-service.log)"
  echo ""
  npm run dev
fi
