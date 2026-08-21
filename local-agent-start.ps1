Set-Location $PSScriptRoot
if (-not $env:SNIPER_WORK_ORIGINS) { $env:SNIPER_WORK_ORIGINS='https://gichul-viewer.pages.dev,http://localhost:5500,http://127.0.0.1:5500' }
$env:SNIPER_SUPABASE_URL='https://nfyyctinvlytykucbgzk.supabase.co'
$env:SNIPER_SUPABASE_ANON_KEY='sb_publishable_tRyg8GTus9I2_wt-VSmaRA_6gbU-lt5'
$env:SNIPER_WORK_EMAILS='amirbatikunari@gmail.com'
Write-Host 'sniper WORK Local Agent v12'
Write-Host "Allowed Work Origins: $env:SNIPER_WORK_ORIGINS"
Write-Host 'Starting on http://127.0.0.1:8788'
node .\local-agent-server.js
