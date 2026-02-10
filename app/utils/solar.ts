// Solar scoring utility - Updated with Evan's sun hour scale

export interface SolarData {
  maxSunshineHoursPerYear: number;
  maxArrayPanelsCount: number;
  maxArrayAreaMeters2: number;
  roofSegmentStats?: RoofSegment[];
}

export interface RoofSegment {
  pitchDegrees: number;    // Roof angle (0-90)
  azimuthDegrees: number;  // Direction (0-360, south=180)
  areaMeters2: number;
  sunshineQuantiles?: number[];
}

export interface SolarScore {
  overall: number;           // 0-100
  category: 'poor' | 'solid' | 'good' | 'great';
  maxPanels: number;
  maxSunshineHours: number;
  hasSouthFacingRoof: boolean;
  southFacingPitch?: number;
}

export function calculateSolarScore(data: SolarData): SolarScore {
  if (!data || !data.maxSunshineHoursPerYear) {
    return {
      overall: 0,
      category: 'poor',
      maxPanels: 0,
      maxSunshineHours: 0,
      hasSouthFacingRoof: false,
    };
  }

  const sunshineHours = data.maxSunshineHoursPerYear;
  const maxPanels = data.maxArrayPanelsCount || 0;

  // Check for south-facing roof (azimuth within 45 degrees of 180 = south)
  let hasSouthFacingRoof = false;
  let southFacingPitch = undefined;

  if (data.roofSegmentStats && data.roofSegmentStats.length > 0) {
    for (const segment of data.roofSegmentStats) {
      const azimuthDiff = Math.abs(segment.azimuthDegrees - 180);
      // South-facing: within 45 degrees of due south (180)
      if (azimuthDiff <= 45) {
        hasSouthFacingRoof = true;
        southFacingPitch = segment.pitchDegrees;
        break; // Only care if there's at least one south-facing segment
      }
    }
  }

  // Calculate score based on sun hours (Evan's scale)
  let score = 0;
  let category: 'poor' | 'solid' | 'good' | 'great' = 'poor';

  if (sunshineHours < 1300) {
    score = Math.round((sunshineHours / 1300) * 25); // 0-25
    category = 'poor';
  } else if (sunshineHours < 1350) {
    score = 25 + Math.round(((sunshineHours - 1300) / 50) * 25); // 25-50
    category = 'solid';
  } else if (sunshineHours < 1400) {
    score = 50 + Math.round(((sunshineHours - 1350) / 50) * 25); // 50-75
    category = 'good';
  } else {
    score = 75 + Math.min(25, Math.round(((sunshineHours - 1400) / 100) * 25)); // 75-100
    category = 'great';
  }

  return {
    overall: score,
    category,
    maxPanels,
    maxSunshineHours: sunshineHours,
    hasSouthFacingRoof,
    southFacingPitch,
  };
}

export function getScoreColor(category: string): string {
  switch (category) {
    case 'great': return '#10b981'; // Green - excellent
    case 'good': return '#3b82f6';  // Blue - good
    case 'solid': return '#f59e0b';  // Amber - solid
    case 'poor': return '#ef4444';  // Red - poor
    default: return '#6b7280';
  }
}

export function getScoreLabel(category: string): string {
  switch (category) {
    case 'great': return '⭐ Great';
    case 'good': return '✅ Good';
    case 'solid': return '⚠️ Solid';
    case 'poor': return '❌ Poor';
    default: return 'Unknown';
  }
}

export function isPoorScore(score: SolarScore): boolean {
  return score.category === 'poor';
}

export function isGoodScore(score: SolarScore): boolean {
  return score.category !== 'poor';
}
