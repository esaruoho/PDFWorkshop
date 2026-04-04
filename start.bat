@echo off
title PDF Workshop
cd /d "%~dp0"

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  Node.js is not installed.
    echo  Download it from: https://nodejs.org
    echo  Choose the LTS version, install it, then run this file again.
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo.
echo  PDF Workshop
echo  ============
echo.

:: Install dependencies if needed
if not exist node_modules (
    echo  Installing dependencies (first run only, may take a minute)...
    call npm install
    echo.
)

:: Open browser after a delay
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

echo  Starting server at http://localhost:3000
echo  Press Ctrl+C to stop.
echo.
call npm run dev
