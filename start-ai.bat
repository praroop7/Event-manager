@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_CMD=python"
where python >nul 2>nul
if errorlevel 1 (
  set "PYTHON_CMD=py -3"
  where py >nul 2>nul
  if errorlevel 1 (
    echo Python was not found. Install Python 3.10 or newer and try again.
    pause
    exit /b 1
  )
)

echo Starting the College Event Manager recommendation service...
%PYTHON_CMD% ai_recommender.py
if errorlevel 1 (
  echo.
  echo The recommendation service stopped with an error.
  pause
)
