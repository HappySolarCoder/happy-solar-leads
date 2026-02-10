# OpenClaw Browser Control - Quick Status Check
# Run: powershell -File setup-browser.ps1

Write-Host ""
Write-Host "🦞 OpenClaw Browser Control - Status Check" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Gateway
Write-Host "1. Gateway Status:" -ForegroundColor White
$gw = openclaw health 2>&1 | Select-String "online|listening|OK"
if ($gw) {
    Write-Host "   ✅ RUNNING on ws://127.0.0.1:18789" -ForegroundColor Green
} else {
    Write-Host "   ❌ NOT RESPONDING" -ForegroundColor Red
    Write-Host "   Try: openclaw gateway --force" -ForegroundColor Yellow
}

# 2. Check Relay
Write-Host "2. Browser Relay:" -ForegroundColor White
$relay = netstat -ano 2>$null | Select-String ":18792"
if ($relay) {
    Write-Host "   ✅ LISTENING on port 18792" -ForegroundColor Green
} else {
    Write-Host "   ❌ NOT LISTENING" -ForegroundColor Red
    Write-Host "   Gateway may need restart" -ForegroundColor Yellow
}

# 3. Check Extension
Write-Host "3. Chrome Extension:" -ForegroundColor White
if (Test-Path "C:\Users\evanr\.openclaw\browser\chrome-extension\manifest.json") {
    Write-Host "   ✅ INSTALLED" -ForegroundColor Green
    Write-Host "   Path: C:\Users\evanr\.openclaw\browser\chrome-extension" -ForegroundColor Gray
} else {
    Write-Host "   ❌ NOT INSTALLED" -ForegroundColor Red
    Write-Host "   Run: openclaw browser extension install" -ForegroundColor Yellow
}

# 4. Check App
Write-Host "4. App Server (localhost:3000):" -ForegroundColor White
$appRunning = $false
$portTest = Test-NetConnection -ComputerName localhost -Port 3000 -WarningAction SilentlyContinue 2>$null
if ($portTest -and $portTest.TcpTestSucceeded) {
    Write-Host "   ✅ RUNNING at http://localhost:3000" -ForegroundColor Green
    $appRunning = $true
} else {
    Write-Host "   ⚠️  NOT RUNNING" -ForegroundColor Yellow
    Write-Host "   Start: npm run dev (in happy-solar-leads folder)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "📋 NEXT STEPS:" -ForegroundColor Cyan
Write-Host ""
Write-Host "To enable browser control:"
Write-Host "1. Open Chrome"
Write-Host "2. Go to:    chrome://extensions"
Write-Host "3. Enable:   'Developer mode' (top-right)"
Write-Host "4. Click:    'Load unpacked'"
Write-Host "5. Select:   C:\Users\evanr\.openclaw\browser\chrome-extension"
Write-Host "6. Pin the extension to toolbar"
Write-Host "7. Go to:    http://localhost:3000"
Write-Host "8. Click:    OpenClaw extension icon"
Write-Host "9. Badge should show:  'ON'"
Write-Host ""
Write-Host "✅ Ready for browser control!" -ForegroundColor Green
Write-Host ""
Write-Host "📖 Full docs: C:\Users\evanr\.openclaw\BROWSER_CONTROL_SETUP.md" -ForegroundColor Cyan
Write-Host ""
