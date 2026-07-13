@echo off
REM Double-click this file in Explorer to start OpenAgent.
cd /d "%~dp0"

echo == 1/5  Python service: virtualenv ==
if not exist "python-service\.venv" (
    python -m venv python-service\.venv
)
call python-service\.venv\Scripts\activate.bat

echo == 2/5  Python service: dependencies ==
if not exist "python-service\.venv\.deps-installed" (
    pip install --quiet --upgrade pip
    pip install --quiet -r python-service\requirements.txt
    type nul > "python-service\.venv\.deps-installed"
) else (
    echo   (already installed, skipping)
)

echo == 3/5  Python service: headless browser binary ==
if not exist "python-service\.venv\.playwright-installed" (
    python -m playwright install chromium
    type nul > "python-service\.venv\.playwright-installed"
) else (
    echo   (already installed, skipping)
)

echo == 4/5  Python service: starting on :8000 ==
if not exist "logs" mkdir logs
if not exist "python-service\data" mkdir python-service\data
start "OpenAgent Python Service" /min cmd /c "cd python-service && uvicorn app.main:app --host 0.0.0.0 --port 8000 > ..\logs\python-service.log 2>&1"

timeout /t 5 /nobreak >nul

echo == 5/5  TS app: dependencies + dev server ==
if exist ".env.local" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
        set "%%A=%%B"
    )
)
if not exist "node_modules" (
    where bun >nul 2>nul
    if %errorlevel%==0 (
        bun install
    ) else (
        npm install
    )
)

echo.
echo Starting the app - the URL to open will be printed below by Vite.
echo (Python service is running in the background; its logs are in logs\python-service.log)
echo.

where bun >nul 2>nul
if %errorlevel%==0 (
    bun run dev
) else (
    npm run dev
)
