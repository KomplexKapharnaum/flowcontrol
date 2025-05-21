@echo off
setlocal enabledelayedexpansion

REM Change to the directory containing the batch file
cd /d "%~dp0"

REM Run your Node.js script
node flowcontrol.js

REM pause
