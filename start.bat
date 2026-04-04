@echo off
title PDF Workshop
cd /d "%~dp0"

:: Use bundled Node.js if available, otherwise check system Node
if exist "node\node.exe" (
    set "PATH=%~dp0node;%PATH%"
    echo  Using bundled Node.js
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo  Node.js not found. Downloading portable Node.js...
        echo.
        powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/node-v20.19.0-win-x64.zip' -OutFile 'node-download.zip'"
        if %errorlevel% neq 0 (
            echo  Download failed. Please install Node.js manually from https://nodejs.org
            pause
            exit /b 1
        )
        echo  Extracting...
        powershell -Command "Expand-Archive -Path 'node-download.zip' -DestinationPath '.' -Force"
        ren "node-v20.19.0-win-x64" node
        del node-download.zip
        set "PATH=%~dp0node;%PATH%"
        echo  Node.js installed locally.
        echo.
    )
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
