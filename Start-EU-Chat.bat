@echo off
setlocal
title Start EU Chat Stack (8017)

echo [0/4] Clearing old SillyTavern on port 8000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8000 .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>nul
)

echo [1/4] Starting llama-server with Qwen3.5-9B Q6...
start "llama-server-8080" cmd /k "cd /d D:\Eureka\llama-server && llama-server.exe -m "D:\Qwen3.5-9B-abliterated-Q6_K.gguf" -c 2048 --port 8080"

echo [2/4] Starting SillyTavern (this copy uses 8017)...
start "SillyTavern-8017" cmd /k "cd /d %~dp0 && npm start"

echo [3/4] Opening EU demo page in browser...
timeout /t 4 >nul
start "" "http://127.0.0.1:8017/eu-demo.html"

echo.
echo Done. Forced old 8000 listener closed, and opened 8017.
exit /b 0
