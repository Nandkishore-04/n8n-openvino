@echo off
echo.
echo   n8n + OpenVINO Model Server Demo
echo   ================================
echo.

:: Check Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Docker is not running. Please start Docker Desktop first.
    exit /b 1
)

:: Build and start
echo   Starting services...
cd deployment
docker compose up -d --build

echo.
echo   Waiting for services to be ready...
timeout /t 15 /nobreak >nul

echo.
echo   Services should now be running:
echo     Mock OVMS Server  -^> http://localhost:9001
echo     n8n Workflow UI   -^> http://localhost:5678
echo.
echo   Next Steps:
echo   1. Open http://localhost:5678 in your browser
echo   2. Create owner account (first time only)
echo   3. Add OVMS credential: Server URL = http://ovms:9001
echo   4. Build the demo workflow with OpenVINO Model Server nodes
echo   5. Click 'Test Workflow' to run the pipeline
echo.
cd ..
