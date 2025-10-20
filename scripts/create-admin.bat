@echo off
REM ParkTayo Admin Account Creation Script (Windows)
REM This batch file runs the create-admin.js script

echo.
echo ================================================
echo ParkTayo Admin Account Creation Script
echo ================================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Change to the backend directory
cd /d "%~dp0\.."

REM Check if package.json exists
if not exist "package.json" (
    echo ERROR: package.json not found
    echo Make sure you're running this from the parktayo-backend directory
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Run the admin creation script
echo Running admin creation script...
echo.
node scripts/create-admin.js %*

echo.
echo Script completed.
pause
