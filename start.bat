@echo off
title PDF Workshop
cd /d "%~dp0"

echo.
echo  ==================
echo   PDF Workshop
echo  ==================
echo.

:: Use bundled Node.js if available, otherwise check system, otherwise download
if exist "node\node.exe" (
    set "PATH=%~dp0node;%PATH%"
    echo  [OK] Using bundled Node.js
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo  Node.js not found. Downloading it now...
        echo  (This is a one-time download, ~30MB)
        echo.
        powershell -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/node-v20.19.0-win-x64.zip' -OutFile 'node-download.zip' } catch { Write-Error $_.Exception.Message; exit 1 }"
        if %errorlevel% neq 0 (
            echo.
            echo  ERROR: Download failed.
            echo  Please install Node.js manually from https://nodejs.org
            echo.
            pause
            exit /b 1
        )
        echo  Extracting Node.js...
        powershell -ExecutionPolicy Bypass -Command "Expand-Archive -Path 'node-download.zip' -DestinationPath '.' -Force"
        if exist "node-v20.19.0-win-x64" (
            ren "node-v20.19.0-win-x64" node
        )
        if exist "node-download.zip" del node-download.zip
        if not exist "node\node.exe" (
            echo.
            echo  ERROR: Node.js extraction failed.
            echo  Please install Node.js manually from https://nodejs.org
            echo.
            pause
            exit /b 1
        )
        set "PATH=%~dp0node;%PATH%"
        echo  [OK] Node.js downloaded and ready
    ) else (
        echo  [OK] Using system Node.js
    )
)

echo.

:: Verify node works
node --version >nul 2>nul
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not working properly.
    echo.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist node_modules (
    echo  Installing dependencies (first run only, this may take 1-2 minutes)...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Failed to install dependencies.
        echo  Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed
    echo.
)

echo  Starting PDF Workshop...
echo  Your browser will open at http://localhost:3000
echo.
echo  If it doesn't open automatically, open this URL in your browser:
echo  http://localhost:3000
echo.
echo  Press Ctrl+C to stop the server.
echo.

:: Open browser after a delay
start /b cmd /c "timeout /t 4 /nobreak >nul && start "" http://localhost:3000"

:: Run the dev server — if it crashes, pause so the user sees the error
call npm run dev

echo.
echo  ==========================================
echo  Server stopped. If this was unexpected,
echo  the error message is shown above.
echo  ==========================================
echo.
pause
