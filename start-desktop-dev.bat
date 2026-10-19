@echo off
setlocal
title AuraView - Desktop Development

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

if not exist "node_modules\.bin\tauri.cmd" (
    echo Project dependencies are missing. Run npm install in this folder first.
    popd
    pause
    exit /b 1
)

echo Starting AuraView in desktop development mode.
echo The first launch may take time while Rust compiles.
echo Save UI changes to see them update live. Rust changes rebuild the app.
echo This starts its own preview server; stop start-dev.bat first if it is running.
echo Keep this window open. Press Ctrl+C to stop development mode.
echo.

call npm.cmd run tauri -- dev
set "devExitCode=%errorlevel%"
popd

if not "%devExitCode%"=="0" (
    echo.
    echo Desktop development stopped with an error. See the message above.
    pause
)

exit /b %devExitCode%
