import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { waypoints, startAddress, endAddress } = await request.json();

    if (!waypoints || waypoints.length < 1) {
      return NextResponse.json({ error: 'Need at least 1 waypoint' }, { status: 400 });
    }

    const key = process.env.GOOGLE_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 400 });
    }

    const MAX_WAYPOINTS = 25;
    const totalWaypoints = waypoints.length;
    console.log('[Route API] Computing optimized route with', totalWaypoints, 'waypoints');

    // Chunk waypoints if > 25
    const chunks: any[][] = [];
    for (let i = 0; i < totalWaypoints; i += MAX_WAYPOINTS) {
      chunks.push(waypoints.slice(i, i + MAX_WAYPOINTS));
    }
    console.log('[Route API] Split into', chunks.length, 'chunks');

    const allOptimizedStops: any[] = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let orderOffset = 0;

    // Process each chunk
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const chunkStartAddress = c === 0 ? startAddress : chunk[0].address || startAddress;
      const chunkEndAddress = c === chunks.length - 1 ? endAddress : chunk[chunk.length - 1].address || endAddress;

      const url = `https://routes.googleapis.com/directions/v2:computeRoutes?key=${key}`;

      const body = {
        origin: { address: chunkStartAddress },
        destination: { address: chunkEndAddress },
        intermediates: chunk.map((w: any) => ({ 
          location: { latLng: { latitude: parseFloat(w.lat.toFixed(7)), longitude: parseFloat(w.lng.toFixed(7)) } } 
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        optimizeWaypointOrder: true,
      };

      console.log(`[Route API] Processing chunk ${c + 1}/${chunks.length} with ${chunk.length} waypoints`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': '*',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[Route API] Chunk ${c + 1} error:`, errorText);
        
        // Fallback: Add chunk stops in original order
        chunk.forEach((wp: any) => {
          orderOffset++;
          allOptimizedStops.push({
            order: orderOffset,
            lat: wp.lat,
            lng: wp.lng,
            address: wp.address || `Stop ${orderOffset}`,
            distanceMeters: 0,
            duration: '0s',
          });
        });
        continue;
      }

      const data = await response.json();
      const route = data.routes?.[0];
      
      if (route && route.waypointOrder) {
        // Reorder chunk according to optimization
        const orderedChunk = route.waypointOrder.map((index: number) => chunk[index]);
        
        orderedChunk.forEach((wp: any, index: number) => {
          const leg = route.legs?.[index];
          orderOffset++;
          allOptimizedStops.push({
            order: orderOffset,
            lat: wp.lat,
            lng: wp.lng,
            address: leg?.endAddress || `Stop ${orderOffset}`,
            distanceMeters: leg?.distanceMeters || 0,
            duration: leg?.duration || '0s',
          });
          
          if (leg?.distanceMeters) totalDistance += leg.distanceMeters;
          if (leg?.duration) {
            totalDuration += parseInt(leg.duration.replace('s', '')) || 0;
          }
        });
      } else {
        // Fallback: Add in original order
        chunk.forEach((wp: any) => {
          orderOffset++;
          allOptimizedStops.push({
            order: orderOffset,
            lat: wp.lat,
            lng: wp.lng,
            address: wp.address || `Stop ${orderOffset}`,
            distanceMeters: 0,
            duration: '0s',
          });
        });
      }
    }

    const result = {
      distanceMeters: totalDistance,
      durationSeconds: totalDuration,
      distanceMiles: Math.round(totalDistance * 0.000621371 * 10) / 10,
      durationMinutes: Math.round(totalDuration / 60),
      stopCount: allOptimizedStops.length,
      optimizedStops: allOptimizedStops,
      chunks: chunks.length,
    };

    console.log('[Route API] Success:', result.distanceMiles, 'mi,', result.durationMinutes, 'min');
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[Route API] Exception:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
