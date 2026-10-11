@echo off
setlocal
cd /d "%~dp0"
title Super Inu - Local server

set "SI_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "SI_NODE=%ProgramFiles%\nodejs\node.exe"
  ) else (
    echo Node.js was not found. No changes have been made to your computer.
    echo Install Node.js from its official website, then open this file again.
    pause
    exit /b 1
  )
)

echo.
echo SUPER INU - NEON DISTRICT
echo.
echo Keep this window OPEN while using Super Inu.
echo Open your browser at: http://127.0.0.1:8051/
echo Closing this window or restarting the PC stops the local server.
echo To start again, double-click START-SUPER-INU.cmd.
echo No public hosting, login or subscription is required.
echo.

"%SI_NODE%" "%~dp0server.mjs"
set "SI_EXIT=%ERRORLEVEL%"
if not "%SI_EXIT%"=="0" (
  echo.
  echo The server could not start. The error is shown above.
  echo If port 8051 is already in use by Super Inu, open the browser URL above.
  echo Do not close or stop unrelated applications using that port.
  pause
)
exit /b %SI_EXIT%
