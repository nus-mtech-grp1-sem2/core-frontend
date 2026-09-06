@echo off
setlocal

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is required but was not found on PATH.
  pause
  exit /b 1
)

cd /d "%~dp0"
echo Stopping any frontend process listening on port 4200...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4200" ^| findstr "LISTENING"') do taskkill /PID %%P /T /F >nul 2>&1
echo Starting OneStage frontend at http://localhost:4200
npm start

endlocal
