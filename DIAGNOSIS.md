# Happy Solar Leads - Upload Error Diagnosis

## 🔴 Critical Issue: Google Geocoding API Not Enabled

**Error:**
```
{
  "status": "REQUEST_DENIED",
  "error_message": "This API is not activated on your API project. You may need to enable this API in the Google Cloud Console"
}
```

**Root Cause:**
The Google Geocoding API (`maps/api/geocode/json`) is **not enabled** for the API key `[REDACTED - rotate; never commit API keys]`.

## ✅ Fix Instructions

1. Go to **Google Cloud Console**: https://console.cloud.google.com/apis/library?filter=category:maps
2. Sign in with the Google account that owns the API key
3. Search for **"Geocoding API"**
4. Click **"Enable"**
5. Wait 2-5 minutes for changes to propagate

## 📝 Alternative: Enable Multiple APIs at Once

For Happy Solar Leads, you may also need:
- **Maps JavaScript API** - for displaying the map
- **Geocoding API** - for address-to-coordinates (currently missing)

## 🔐 API Key Security (Optional)

Once working, restrict the API key to:
- **Application restrictions**: HTTP referrers (your localhost for dev, production domain for prod)
- **API restrictions**: Only allow Geocoding API and Maps JavaScript API

---

## 📊 Test Results Summary

| Test | Status |
|------|--------|
| CSV Parsing | ✅ Working |
| localStorage | ✅ Working |
| Geocoding API | ❌ Not Enabled |

## 💡 Why Upload Appears to "Hang"

When geocoding fails:
1. The UI shows "Processing..." indefinitely
2. No error is surfaced to the user clearly
3. All addresses end up in the "failed addresses" list

This is why you weren't seeing obvious error messages.
