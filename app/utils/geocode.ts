// Geocoding utility using Next.js API proxy to avoid CORS

import { CSVRow, Lead, PropertyType } from '@/app/types';

// Determine property type from Google's place types
function determinePropertyType(types: string[]): PropertyType {
  if (!types || types.length === 0) return 'unknown';
  
  // Apartment indicators
  if (types.includes('subpremise')) return 'apartment';
  
  // Commercial indicators
  if (types.includes('establishment') || types.includes('point_of_interest')) {
    return 'commercial';
  }
  
  // House/residential indicators
  if (types.includes('premise') || types.includes('street_address') || types.includes('route')) {
    return 'house';
  }
  
  return 'unknown';
}

// Cache key for geocoding results
const GEOCODE_CACHE_KEY = 'happy_solar_geocode_cache';

// Address cache (loaded from localStorage)
let addressCache: Map<string, { lat: number; lng: number } | null> | null = null;

function loadCache(): Map<string, { lat: number; lng: number } | null> {
  if (addressCache) return addressCache;

  try {
    const cached = localStorage.getItem(GEOCODE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      addressCache = new Map(Object.entries(parsed));
    } else {
      addressCache = new Map();
    }
  } catch (e) {
    addressCache = new Map();
  }
  return addressCache;
}

function saveCache() {
  if (!addressCache) return;
  try {
    const obj = Object.fromEntries(addressCache);
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    // Ignore cache save errors
  }
}

function getCacheKey(row: CSVRow | Lead): string {
  return `${row.address?.toLowerCase().trim()}, ${row.city?.toLowerCase().trim()}, ${row.state?.toLowerCase().trim()} ${row.zip?.trim()}`;
}

// Check if we already have coordinates for this address
export function getCachedCoordinates(row: CSVRow | Lead): { lat: number; lng: number } | null {
  const cache = loadCache();
  const key = getCacheKey(row);
  return cache.get(key) || null;
}

// Geocode a single address using our proxy API (bypasses CORS)
export async function geocodeAddress(row: CSVRow): Promise<{ lat: number; lng: number; propertyType: PropertyType } | null> {
  // Check cache first
  const cached = getCachedCoordinates(row);
  if (cached) {
    // Note: Cached results don't have propertyType (old cache), will need re-geocoding to get it
    return { ...cached, propertyType: 'unknown' };
  }

  const query = `${row.address}, ${row.city}, ${row.state} ${row.zip}`;

  try {
    // Use our own API route as proxy to avoid CORS
    const response = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: query }),
    });

    if (!response.ok) {
      // Cache negative result (address not found)
      const cache = loadCache();
      cache.set(getCacheKey(row), null);
      saveCache();
      return null;
    }

    const data = await response.json();

    // API returns { lat, lng, formattedAddress, types } directly
    if (data.lat && data.lng) {
      const coords = { lat: data.lat, lng: data.lng };
      const propertyType = determinePropertyType(data.types || []);

      // Save to cache (coords only, not propertyType - cache is simple)
      const cache = loadCache();
      cache.set(getCacheKey(row), coords);
      saveCache();

      return { ...coords, propertyType };
    }

    // Cache negative result (address not found)
    const cache = loadCache();
    cache.set(getCacheKey(row), null);
    saveCache();

    return null;
  } catch (error) {
    return null;
  }
}

// Batch geocode with progress tracking
export async function geocodeBatch(
  rows: CSVRow[],
  onProgress?: (current: number, total: number) => void
): Promise<Array<{ row: CSVRow; lat?: number; lng?: number; propertyType?: PropertyType }>> {
  const results: Array<{ row: CSVRow; lat?: number; lng?: number; propertyType?: PropertyType }> = [];
  const cache = loadCache();

  // Separate rows that need geocoding vs cached
  const uncachedRows: CSVRow[] = [];
  const uncachedIndices: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const cached = getCachedCoordinates(rows[i]);
    if (cached) {
      results.push({ row: rows[i], lat: cached.lat, lng: cached.lng, propertyType: 'unknown' });
    } else {
      uncachedRows.push(rows[i]);
      uncachedIndices.push(i);
    }
  }

  // Process uncached rows in batches
  const BATCH_SIZE = 10;
  const DELAY_MS = 100;

  for (let batchStart = 0; batchStart < uncachedRows.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, uncachedRows.length);
    const batch = uncachedRows.slice(batchStart, batchEnd);
    const batchIndices = uncachedIndices.slice(batchStart, batchEnd);

    // Fire all requests in parallel
    const promises = batch.map(async (row, idx) => {
      const result = await geocodeAddress(row);
      return { result, originalIndex: batchIndices[idx] };
    });

    const batchResults = await Promise.all(promises);

    // Collect results
    for (const { result, originalIndex } of batchResults) {
      results[originalIndex] = {
        row: rows[originalIndex],
        lat: result?.lat,
        lng: result?.lng,
        propertyType: result?.propertyType || 'unknown',
      };
    }

    // Report progress
    const processed = batchEnd;
    onProgress?.(processed, rows.length);

    // Rate limit delay between batches
    if (batchEnd < uncachedRows.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  return results;
}

// Clear the geocoding cache
export function clearGeocodeCache() {
  addressCache = null;
  localStorage.removeItem(GEOCODE_CACHE_KEY);
}

// Get cache statistics
export function getCacheStats() {
  const cache = loadCache();
  const entries = cache.size;
  const cached = Array.from(cache.values()).filter(v => v !== null).length;
  const failed = entries - cached;
  return { total: entries, cached, failed };
}

// Reverse geocoding (address from coordinates)
// NOTE: This function is not currently used. If needed, create a server-side
// API route at /api/reverse-geocode to avoid exposing the API key.
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    // TODO: Implement via server-side API route at /api/reverse-geocode
    // For now, this function is not used anywhere in the codebase
    console.warn('reverseGeocode: Not implemented - create /api/reverse-geocode route');
    return null;
  } catch (error) {
    return null;
  }
}
