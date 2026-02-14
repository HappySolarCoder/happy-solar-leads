// Virtual Manager AI - Performance Analysis & Coaching
import { Lead, User } from '@/app/types';

export interface DailyMetrics {
  date: string;
  setterId: string;
  setterName: string;
  doorsKnocked: number;
  appointments: number;
  notInterested: number;
  conversionRate: number; // appointments / doorsKnocked
  pace: number; // doors per hour
  primeTimeKnocks: number; // knocks between 4:30pm and sunset
  primeTimePercentage: number;
  objections: { [key: string]: number };
  territorySize: number; // unique addresses visited
  averageDistanceBetweenKnocks: number; // meters
}

export interface RedFlag {
  type: 'early_knocking' | 'low_conversion' | 'slow_pace' | 'poor_territory';
  severity: 'warning' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

export interface CoachingInsight {
  category: 'positive' | 'improvement' | 'concern';
  message: string;
  actionable: boolean;
  suggestedAction?: string;
}

export interface AIAnalysis {
  setterId: string;
  setterName: string;
  date: string;
  daysSinceStart: number; // How long they've been knocking
  metrics: DailyMetrics;
  redFlags: RedFlag[];
  insights: CoachingInsight[];
  coachingMessage: string; // Natural language summary from Gemini
}

/**
 * Calculate daily metrics for a setter
 */
export function calculateDailyMetrics(
  setterId: string,
  setterName: string,
  leads: Lead[],
  date: Date = new Date()
): DailyMetrics {
  const dateStr = date.toISOString().split('T')[0];
  
  // Filter leads for this setter and this date
  const todayLeads = leads.filter(lead => {
    if (lead.claimedBy !== setterId) return false;
    if (!lead.knockGpsTimestamp) return false;
    
    const knockDate = new Date(lead.knockGpsTimestamp).toISOString().split('T')[0];
    return knockDate === dateStr;
  });

  const doorsKnocked = todayLeads.length;
  const appointments = todayLeads.filter(l => 
    l.disposition?.toLowerCase().includes('appointment') ||
    l.disposition?.toLowerCase().includes('callback')
  ).length;
  
  const notInterested = todayLeads.filter(l =>
    l.disposition?.toLowerCase().includes('not interested')
  ).length;

  const conversionRate = doorsKnocked > 0 ? (appointments / doorsKnocked) * 100 : 0;

  // Calculate pace (doors per hour)
  const timestamps = todayLeads
    .filter(l => l.knockGpsTimestamp)
    .map(l => new Date(l.knockGpsTimestamp!).getTime())
    .sort((a, b) => a - b);
  
  let pace = 0;
  if (timestamps.length > 1) {
    const firstKnock = timestamps[0];
    const lastKnock = timestamps[timestamps.length - 1];
    const hoursWorked = (lastKnock - firstKnock) / (1000 * 60 * 60);
    pace = hoursWorked > 0 ? doorsKnocked / hoursWorked : 0;
  }

  // Prime time knocks (4:30pm to sunset)
  // For now, use 4:30pm to 8:30pm as approximation
  const primeTimeStart = 16.5; // 4:30pm in decimal hours
  const primeTimeEnd = 20.5; // 8:30pm
  
  const primeTimeKnocks = todayLeads.filter(l => {
    if (!l.knockGpsTimestamp) return false;
    const knockTime = new Date(l.knockGpsTimestamp);
    const hourDecimal = knockTime.getHours() + (knockTime.getMinutes() / 60);
    return hourDecimal >= primeTimeStart && hourDecimal <= primeTimeEnd;
  }).length;

  const primeTimePercentage = doorsKnocked > 0 ? (primeTimeKnocks / doorsKnocked) * 100 : 0;

  // Objection tracking
  const objections: { [key: string]: number } = {};
  todayLeads.forEach(lead => {
    if (lead.objectionType) {
      objections[lead.objectionType] = (objections[lead.objectionType] || 0) + 1;
    }
  });

  // Territory coverage
  const uniqueAddresses = new Set(todayLeads.map(l => `${l.lat},${l.lng}`));
  const territorySize = uniqueAddresses.size;

  // Average distance between knocks
  let totalDistance = 0;
  let distanceCount = 0;
  for (let i = 1; i < todayLeads.length; i++) {
    const prev = todayLeads[i - 1];
    const curr = todayLeads[i];
    if (prev.lat && prev.lng && curr.lat && curr.lng) {
      const distance = calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
      totalDistance += distance;
      distanceCount++;
    }
  }
  const averageDistanceBetweenKnocks = distanceCount > 0 ? totalDistance / distanceCount : 0;

  return {
    date: dateStr,
    setterId,
    setterName,
    doorsKnocked,
    appointments,
    notInterested,
    conversionRate,
    pace,
    primeTimeKnocks,
    primeTimePercentage,
    objections,
    territorySize,
    averageDistanceBetweenKnocks,
  };
}

/**
 * Detect red flags in performance
 */
export function detectRedFlags(metrics: DailyMetrics, daysSinceStart: number): RedFlag[] {
  const flags: RedFlag[] = [];

  // Red Flag 1: Too much early knocking (>60% before prime time)
  if (metrics.primeTimePercentage < 40 && metrics.doorsKnocked >= 10) {
    flags.push({
      type: 'early_knocking',
      severity: 'warning',
      message: 'Most knocks happening before prime time (4:30pm)',
      metric: 'Prime Time %',
      value: metrics.primeTimePercentage,
      threshold: 40,
    });
  }

  // Red Flag 2: Low conversion rate
  const isVeteran = daysSinceStart > 30;
  const conversionThreshold = isVeteran ? 2.0 : 1.0;
  
  if (metrics.conversionRate < conversionThreshold && metrics.doorsKnocked >= 20) {
    flags.push({
      type: 'low_conversion',
      severity: metrics.conversionRate < (conversionThreshold / 2) ? 'critical' : 'warning',
      message: `Conversion rate below ${conversionThreshold}%`,
      metric: 'Conversion Rate',
      value: metrics.conversionRate,
      threshold: conversionThreshold,
    });
  }

  // Red Flag 3: Slow pace
  if (metrics.pace > 0 && metrics.pace < 8 && metrics.doorsKnocked >= 10) {
    flags.push({
      type: 'slow_pace',
      severity: 'warning',
      message: 'Pace slower than 8 doors per hour',
      metric: 'Pace',
      value: metrics.pace,
      threshold: 8,
    });
  }

  // Red Flag 4: Poor territory coverage (revisiting same areas)
  const uniquenessRatio = metrics.territorySize / metrics.doorsKnocked;
  if (uniquenessRatio < 0.7 && metrics.doorsKnocked >= 20) {
    flags.push({
      type: 'poor_territory',
      severity: 'warning',
      message: 'Knocking same addresses multiple times',
      metric: 'Territory Uniqueness',
      value: uniquenessRatio * 100,
      threshold: 70,
    });
  }

  return flags;
}

/**
 * Generate coaching insights
 */
export function generateInsights(
  metrics: DailyMetrics,
  redFlags: RedFlag[],
  daysSinceStart: number
): CoachingInsight[] {
  const insights: CoachingInsight[] = [];

  // Positive reinforcement
  if (metrics.conversionRate >= 3) {
    insights.push({
      category: 'positive',
      message: `Excellent conversion rate of ${metrics.conversionRate.toFixed(1)}%!`,
      actionable: false,
    });
  }

  if (metrics.pace >= 12) {
    insights.push({
      category: 'positive',
      message: `Great pace at ${metrics.pace.toFixed(1)} doors/hour!`,
      actionable: false,
    });
  }

  if (metrics.primeTimePercentage >= 60) {
    insights.push({
      category: 'positive',
      message: `Knocking during prime time - ${metrics.primeTimePercentage.toFixed(0)}% of knocks after 4:30pm`,
      actionable: false,
    });
  }

  // Improvement suggestions based on red flags
  redFlags.forEach(flag => {
    if (flag.type === 'early_knocking') {
      insights.push({
        category: 'improvement',
        message: 'Focus knocking between 4:30pm and sunset for better homeowner availability',
        actionable: true,
        suggestedAction: 'Start later in the day or revisit early knocks during prime time',
      });
    }

    if (flag.type === 'low_conversion') {
      insights.push({
        category: 'concern',
        message: 'Conversion rate needs improvement',
        actionable: true,
        suggestedAction: daysSinceStart < 30
          ? 'Review pitch script and practice objection handling'
          : 'Schedule coaching session to review approach',
      });
    }

    if (flag.type === 'slow_pace') {
      insights.push({
        category: 'improvement',
        message: 'Pace could be faster - aim for 10-12 doors per hour',
        actionable: true,
        suggestedAction: 'Spend less time between doors, keep moving',
      });
    }

    if (flag.type === 'poor_territory') {
      insights.push({
        category: 'improvement',
        message: 'Knocking same addresses multiple times - spread out more',
        actionable: true,
        suggestedAction: 'Use map to visualize knocked vs available leads',
      });
    }
  });

  // Objection patterns
  const topObjection = Object.entries(metrics.objections)
    .sort(([, a], [, b]) => b - a)[0];
  
  if (topObjection && topObjection[1] >= 3) {
    insights.push({
      category: 'improvement',
      message: `"${topObjection[0]}" is your most common objection (${topObjection[1]} times)`,
      actionable: true,
      suggestedAction: `Review objection handling for "${topObjection[0]}"`,
    });
  }

  return insights;
}

/**
 * Calculate distance between two points (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Call Gemini API for natural language coaching
 */
export async function generateCoachingMessage(
  metrics: DailyMetrics,
  redFlags: RedFlag[],
  insights: CoachingInsight[],
  daysSinceStart: number
): Promise<string> {
  const isVeteran = daysSinceStart > 30;
  const tone = isVeteran ? 'direct and constructive' : 'encouraging and supportive';

  const prompt = `You are a sales manager coaching a door-to-door solar setter. Analyze their performance and provide brief, actionable feedback.

**Setter:** ${metrics.setterName}
**Experience:** ${daysSinceStart} days (${isVeteran ? 'Veteran' : 'New'})
**Date:** ${metrics.date}

**Metrics:**
- Doors knocked: ${metrics.doorsKnocked}
- Appointments: ${metrics.appointments}
- Conversion rate: ${metrics.conversionRate.toFixed(1)}%
- Pace: ${metrics.pace.toFixed(1)} doors/hour
- Prime time knocks: ${metrics.primeTimePercentage.toFixed(0)}%

**Red Flags:**
${redFlags.length > 0 ? redFlags.map(f => `- ${f.message}`).join('\n') : 'None'}

**Insights:**
${insights.map(i => `- ${i.message}`).join('\n')}

Write a brief (3-4 sentences) coaching message with a ${tone} tone. Focus on what they did well and 1-2 specific improvements. Be human, not robotic.`;

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + process.env.NEXT_PUBLIC_GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 256,
        },
      }),
    });

    const data = await response.json();
    const message = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Analysis complete. Review your metrics above.';
    return message.trim();
  } catch (error) {
    console.error('Gemini API error:', error);
    // Fallback to template-based message
    return generateFallbackMessage(metrics, redFlags, insights, isVeteran);
  }
}

/**
 * Fallback coaching message (when API fails)
 */
function generateFallbackMessage(
  metrics: DailyMetrics,
  redFlags: RedFlag[],
  insights: CoachingInsight[],
  isVeteran: boolean
): string {
  const positive = insights.filter(i => i.category === 'positive');
  const improvements = insights.filter(i => i.category === 'improvement' || i.category === 'concern');

  let message = '';

  if (positive.length > 0) {
    message += positive[0].message + ' ';
  }

  if (improvements.length > 0) {
    message += improvements[0].message;
    if (improvements[0].suggestedAction) {
      message += ' ' + improvements[0].suggestedAction + '.';
    }
  } else if (metrics.doorsKnocked > 0) {
    message += `Great work today! Keep up the momentum.`;
  }

  return message || 'Keep pushing forward!';
}
