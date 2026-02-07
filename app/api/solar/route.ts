import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { lat, lng, apiKey } = await request.json();

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Missing lat or lng' }, { status: 400 });
    }

    // Use the provided API key or environment variable
    const key = apiKey || process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 400 });
    }

    const url = `https://solar.googleapis.com/v1/buildingInsights:getByLocation?location.latitude=${lat}&location.longitude=${lng}&key=${key}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: response.statusText, details: errorText }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
