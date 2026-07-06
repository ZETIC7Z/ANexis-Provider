@echo off
title TMDB-Embed-API Server
cd /d "c:\Users\Administrator\Music\TMDB-Embed-API"
:restart
echo [%time%] Starting server...
node apiServer.js
echo [%time%] Server exited, restarting in 2 seconds...
timeout /t 2 /nobreak
goto restart
