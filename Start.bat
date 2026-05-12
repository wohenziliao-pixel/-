@echo off
pushd %~dp0
set NODE_ENV=production
REM 跳过 npm install（node_modules 已存在）
node server.js %*
pause
popd
