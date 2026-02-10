# Quick Reference: OpenClaw Browser Control

## Current Status
✅ Gateway: ws://127.0.0.1:18789  
✅ Relay: http://127.0.0.1:18792 (listening)  
✅ Extension: installed  
✅ App: http://localhost:3000  

## To Connect Browser to App (5 steps)

```
1. Chrome → chrome://extensions
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select: C:\Users\evanr\.openclaw\browser\chrome-extension
5. Go to http://localhost:3000 → Click extension icon
   (badge should show "ON")
```

## If Not Working

**Gateway down?**  
`openclaw gateway --force`

**Extension doesn't appear?**  
- Go to chrome://extensions
- Click PIN icon on "OpenClaw Browser Relay"

**Badge shows OFF?**  
- Click extension icon again
- Make sure localhost:3000 is the active tab
- Refresh the page

**App not running?**  
```powershell
cd C:\Users\evanr\.openclaw\workspace\happy-solar-leads
npm run dev
```

---

**Full docs**: `C:\Users\evanr\.openclaw\BROWSER_CONTROL_SETUP.md`
