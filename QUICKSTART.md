# Quickstart

## Run everything with one command

```bash
./start.sh
```

(Mac: you can also double-click `start.command`. Windows: double-click
`start.bat`.)

This single command:
1. Creates the Python virtualenv if missing and installs dependencies
2. Downloads the headless Chromium binary Playwright needs (first run only)
3. Starts the Python multi-agent service in the background (port 8000)
4. Installs JS dependencies if missing
5. Starts the TS app's dev server in the foreground — **the URL to open is
   printed in the terminal by Vite** (this project auto-picks a port; don't
   assume it's always the same one)

Stop everything with `Ctrl+C` — it cleans up the background Python process
too.

## Keys — already wired up

Your Gemini key and bridge secret are already in `python-service/.env` and
`.env.local` (both git-ignored — real secrets never touch the tracked
`.env`, which only holds public Supabase values). You don't need to paste
anything into any config screen.

If you regenerate/rotate either key later, edit those two files directly —
no other config, and restart `./start.sh`.

## Signing in

- **Signing into the app itself**: the "Continue with Google" button on
  `/auth` already works out of the box — it goes through Lovable's managed
  OAuth (`lovable.auth.signInWithOAuth`), which doesn't need a Google Cloud
  Console app or client ID/secret from you.
- **Signing the agent's own browser into Google** (so it can browse
  Google-authenticated pages on its own): Google blocks automated login
  attempts by design, so there's no "just works" tool for this — run
  `python python-service/scripts/login_google.py <your_user_id>` once. A
  real visible browser window opens; log in by hand (solve any
  captcha/2FA yourself); close it. The agent's browser reuses that saved
  session from then on. Details: `docs/PYTHON_SERVICE.md`.

## If something's off

- `logs/python-service.log` has the Python service's output.
- `curl http://localhost:8000/api/v1/health -H "X-OpenAgent-Bridge-Token: <value from python-service/.env>"` should return `{"status":"ok"}`.
- Full architecture, what's genuinely tested vs. not, and every caveat:
  `docs/PYTHON_SERVICE.md`.
