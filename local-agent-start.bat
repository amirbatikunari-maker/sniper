@echo off
cd /d "%~dp0"
if "%SNIPER_WORK_ORIGINS%"=="" set "SNIPER_WORK_ORIGINS=https://gichul-viewer.pages.dev,https://sniper.pages.dev,http://localhost:5500,http://127.0.0.1:5500"
echo sniper WORK Local Agent v16
echo Allowed Work Origins: %SNIPER_WORK_ORIGINS%
echo Starting on http://127.0.0.1:8788
set "SNIPER_SUPABASE_URL=https://nfyyctinvlytykucbgzk.supabase.co"
set "SNIPER_SUPABASE_ANON_KEY=sb_publishable_tRyg8GTus9I2_wt-VSmaRA_6gbU-lt5"
set "SNIPER_WORK_EMAILS=amirbatikunari@gmail.com"
node local-agent-server.js
pause
