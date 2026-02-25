import { Lead } from '@/app/types';

/**
 * Knockability Score Algorithm
 * 
 * Factors:
 * - Solar Fit (40%): Based on solarScore and solarCategory
 * - Days Since Last Knock (30%): Fresh leads or leads that need follow-up
 * - Time of Day Fit (20%): Based on time since disposition
 * - Territory Clustering (10%): Leads in same area for efficient routing
 */

interface KnockabilityScore {
  total: number; // 0-100
  solarScore: number; // 0-40
  freshnessScore: number; // 0-30
  timeScore: number; // 0-20
  clusterScore: number; // 0-10
  reasons: string[]; // Why this score
}

// Solar category weights
const SOLAR_CATEGORY_SCORES: Record<string, number> = {
  'great': 40,
  'good': 30,
  'solid': 20,
  'poor': 5,
};

// Weights for each factor
const WEIGHTS = {
  solar: 0.40,
  freshness: 0.30,
  timeOfDay: 0.20,
  clustering: 0.10,
};

/**
 * Calculate knockability score for a single lead
 */
export function calculateKnockabilityScore(lead: Lead, currentHour?: number): KnockabilityScore {
  const reasons: string[] = [];
  const now = new Date();
  const hour = currentHour ?? now.getHours();

  // 1. Solar Fit Score (0-40)
  let solarScore = 0;
  if (lead.solarScore !== undefined) {
    // Use actual solar score (0-100) scaled to 40
    solarScore = (lead.solarScore / 100) * 40;
  } else if (lead.solarCategory) {
    // Fall back to category
    solarScore = SOLAR_CATEGORY_SCORES[lead.solarCategory] || 10;
    reasons.push(`${lead.solarCategory} solar fit`);
  } else {
    // No solar data - give moderate score
    solarScore = 20;
    reasons.push('No solar data');
  }

  // 2. Freshness Score (0-30) - Days since created or last dispositioned
  let freshnessScore = 30; // Start at max
  
  const lastActionDate = lead.dispositionedAt || lead.createdAt;
  const daysSinceAction = Math.floor((now.getTime() - new Date(lastActionDate).getTime()) / (1000 * 60 * 60 * 24));
  
  // Optimal: 0-2 days old = 30 points
  // Good: 3-7 days = 20 points  
  // Fair: 8-14 days = 10 points
  // Stale: 14+ days = 5 points
  if (daysSinceAction <= 2) {
    freshnessScore = 30;
    reasons.push('Fresh lead');
  } else if (daysSinceAction <= 7) {
    freshnessScore = 20;
    reasons.push(`${daysSinceAction} days old`);
  } else if (daysSinceAction <= 14) {
    freshnessScore = 10;
    reasons.push('Needs follow-up');
  } else {
    freshnessScore = 5;
    reasons.push('Stale lead');
  }

  // 3. Time of Day Score (0-20)
  // Best knocking hours: 9am-7pm
  let timeScore = 0;
  if (hour >= 9 && hour <= 12) {
    timeScore = 20; // Morning - best time
    reasons.push('Morning (best time)');
  } else if (hour >= 13 && hour <= 17) {
    timeScore = 15; // Afternoon - good time
    reasons.push('Afternoon');
  } else if (hour >= 18 && hour <= 20) {
    timeScore = 10; // Evening - okay
    reasons.push('Evening');
  } else {
    timeScore = 5; // Night - not ideal
    reasons.push('Outside peak hours');
  }

  // 4. Cluster Score (0-10) - Placeholder for territory clustering
  // This would be enhanced with actual territory/clustering logic
  let clusterScore = 5; // Default middle score
  reasons.push('Standard location');

  // Calculate total
  const total = Math.round(solarScore + freshnessScore + timeScore + clusterScore);

  return {
    total,
    solarScore: Math.round(solarScore),
    freshnessScore: Math.round(freshnessScore),
    timeScore: Math.round(timeScore),
    clusterScore: Math.round(clusterScore),
    reasons,
  };
}

/**
 * Sort leads by knockability score (highest first)
 */
export function sortByKnockability(leads: Lead[], currentHour?: number): Lead[] {
  const hour = currentHour ?? new Date().getHours();
  
  return [...leads].sort((a, b) => {
    const scoreA = calculateKnockabilityScore(a, hour).total;
    const scoreB = calculateKnockabilityScore(b, hour).total;
    return scoreB - scoreA; // Descending order
  });
}

/**
 * Get color for knockability score
 */
export function getKnockabilityColor(score: number): string {
  if (score >= 80) return '#10B981'; // Green - Excellent
  if (score >= 60) return '#3B82F6'; // Blue - Good
  if (score >= 40) return '#F59E0B'; // Yellow - Fair
  return '#EF4444'; // Red - Poor
}

/**
 * Get label for knockability score
 */
export function getKnockabilityLabel(score: number): string {
  if (score >= 80) return 'Hot';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Cold';
}
