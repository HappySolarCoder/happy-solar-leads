import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { lat, lng, apiKey } = await request.json();

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Missing lat or lng' }, { status: 400 });
    }

    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 400 });
    }

    // Correct Solar API endpoint - buildingInsights:findClosest
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${key}`;

    console.log('[Solar] Fetching from:', url.replace(key, 'API_KEY_HIDDEN'));

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log('[Solar] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[Solar] Error:', errorText.substring(0, 500));
      return NextResponse.json({ 
        error: response.statusText, 
        details: errorText.substring(0, 500) 
      }, { status: response.status });
    }

    const data = await response.json();
    console.log('[Solar] Success! Data keys:', Object.keys(data || {}).join(', '));
    return NextResponse.json(data);

  } catch (error: any) {
    console.error('[Solar] Exception:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
