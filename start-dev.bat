@echo off
setlocal
title AuraView - Development Preview

pushd "%~dp0"
if errorlevel 1 (
    echo Could not open the AuraView project folder.
    pause
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Node.js and npm are required. Install Node.js, then run this file again.
    popd
    pause
    exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
    echo Project dependencies are missing. Run npm install in this folder first.
    popd
    pause
    exit /b 1
)

echo Starting AuraView at http://localhost:1420
echo Your browser will open automatically. Save UI changes to see them update.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.

call npm.cmd run dev -- --open
set "devExitCode=%errorlevel%"
popd

if not "%devExitCode%"=="0" (
    echo.
    echo The development server stopped with an error. See the message above.
    pause
)

exit /b %devExitCode%
