import { NextRequest, NextResponse } from 'next/server';

// GET for reverse geocoding (lat/lng -> address) or forward geocoding (address -> lat/lng)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const address = searchParams.get('address');

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key in environment' }, { status: 500 });
    }

    // Forward geocoding (address -> lat/lng)
    if (address) {
      const encodedQuery = encodeURIComponent(address);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedQuery}&key=${apiKey}`;

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Geocode API] Google error:', errorText);
        return NextResponse.json({ error: response.statusText, details: errorText }, { status: response.status });
      }

      const data = await response.json();

      if (data.status !== 'OK') {
        return NextResponse.json({ error: `Geocoding failed: ${data.status}` }, { status: 400 });
      }

      return NextResponse.json({
        results: data.results,
      });
    }

    // Reverse geocoding (lat/lng -> address)
    if (!lat || !lng) {
      return NextResponse.json({ error: 'Missing lat/lng or address' }, { status: 400 });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Reverse Geocode API] Google error:', errorText);
      return NextResponse.json({ error: response.statusText, details: errorText }, { status: response.status });
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      return NextResponse.json({ error: `Reverse geocoding failed: ${data.status}` }, { status: 400 });
    }

    return NextResponse.json({
      results: data.results,
      formattedAddress: data.results[0]?.formatted_address,
    });

  } catch (error: any) {
    console.error('[Geocode API] Exception:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST for forward geocoding (address -> lat/lng)
export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();

    if (!address) {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key in environment' }, { status: 500 });
    }

    const encodedQuery = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedQuery}&key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Geocode API] Google error:', errorText);
      return NextResponse.json({ error: response.statusText, details: errorText }, { status: response.status });
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      return NextResponse.json({ error: `Geocoding failed: ${data.status}` }, { status: 400 });
    }

    const result = data.results[0];
    const location = result.geometry.location;

    return NextResponse.json({
      lat: location.lat,
      lng: location.lng,
      formattedAddress: result.formatted_address,
      types: result.types || [], // Property type indicators
    });

  } catch (error: any) {
    console.error('[Geocode API] Exception:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
