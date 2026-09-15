@echo off
title MarketFlow ToS helper
cd /d "%~dp0"
echo MarketFlow ToS helper — leave this window open while using Charts.
echo After it says listening: Settings → Calibrate → click the ToS symbol box.
echo Recalibrate at each startup or whenever you move Thinkorswim.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tos-agent.ps1"
echo.
pause
