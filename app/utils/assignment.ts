// Auto-assignment AI algorithm for distributing leads to setters
// Priority: Distance → Solar Quality → Workload Balance
// All major operations are logged for debugging

import { Lead, User } from '@/app/types';

// Logger utility
function log(level: 'INFO' | 'WARN' | 'ERROR', component: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${level}] [${component}] [${timestamp}] ${message}`;
  
  if (data) {
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](logEntry, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](logEntry);
  }
}

export interface AssignmentResult {
  leadId: string;
  leadName: string;
  leadAddress: string;
  assignedToId: string;
  assignedToName: string;
  distance: number;
  reason: string;
}

export interface AssignmentSummary {
  totalAssigned: number;
  totalSkipped: number;
  byUser: Record<string, { count: number; leads: AssignmentResult[] }>;
  errors: string[];
}

// ============================================
// DISTANCE CALCULATION (Haversine Formula)
// ============================================

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in miles
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// ============================================
// STALE LEAD DETECTION
// ============================================

/**
 * Find leads that haven't been dispositioned in X days
 */
export function getStaleLeads(
  leads: Lead[],
  staleDays: number = 5
): Lead[] {
  log('INFO', 'Assignment', 'Checking for stale leads', { 
    totalLeads: leads.length, 
    staleDaysThreshold: staleDays 
  });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - staleDays);

  const stale = leads.filter(lead => {
    // Lead is stale if:
    // 1. Has assignment/claim date
    // 2. Hasn't been dispositioned since
    // 3. Assignment was before cutoff
    if (!lead.assignedAt && !lead.claimedAt) return false;
    
    const assignmentDate = lead.assignedAt || lead.claimedAt;
    if (!assignmentDate) return false;
    
    // If never dispositioned and assignment is old enough
    if (!lead.dispositionedAt) {
      return new Date(assignmentDate) < cutoffDate;
    }
    
    // If dispositioned but assignment was before cutoff
    const assignmentTime = new Date(assignmentDate).getTime();
    const dispositionTime = new Date(lead.dispositionedAt).getTime();
    
    // Stale if assigned before cutoff and not dispositioned after assignment
    return assignmentTime < cutoffDate.getTime() && dispositionTime < assignmentTime;
  });

  log('INFO', 'Assignment', `Found ${stale.length} stale leads`);
  return stale;
}

// ============================================
// AUTO-ASSIGNMENT ENGINE
// ============================================

export interface AutoAssignOptions {
  maxDistance?: number;                    // Max miles from setter home (default: 50)
  onlyCategories?: Array<'poor' | 'solid' | 'good' | 'great'>;  // Filter by category
  onlyUnclaimed?: boolean;                 // Only assign unclaimed leads
  dryRun?: boolean;                        // Preview without saving
}

export interface AutoAssignResult {
  leads: Lead[];
  users: User[];
  summary: AssignmentSummary;
}

/**
 * Main auto-assignment function
 */
export function autoAssignLeads(
  leads: Lead[],
  users: User[],
  options: AutoAssignOptions = {}
): AutoAssignResult {
  const startTime = Date.now();
  
  log('INFO', 'Assignment', 'Starting auto-assignment', {
    leadCount: leads.length,
    userCount: users.length,
    options
  });

  const {
    maxDistance = 50,
    onlyCategories,
    onlyUnclaimed = true,
    dryRun = false,
  } = options;

  // Filter to leads that need assignment
  let assignableLeads = leads.filter(lead => {
    // Skip poor solar leads unless explicitly included
    if (onlyCategories && !onlyCategories.includes(lead.solarCategory || 'solid')) {
      return false;
    }
    
    // Skip already claimed leads unless specified
    if (onlyUnclaimed && lead.status !== 'unclaimed') {
      return false;
    }
    
    // Skip if already assigned to someone
    if (lead.assignedTo) {
      return false;
    }
    
    return true;
  });

  log('INFO', 'Assignment', `${assignableLeads.length} leads eligible for assignment`);

  // Filter to active setters with home locations
  const activeSetters = users.filter(user => 
    user.isActive !== false && 
    user.homeLat && 
    user.homeLng
  );

  log('INFO', 'Assignment', `${activeSetters.length} active setters with locations`);

  if (activeSetters.length === 0) {
    log('WARN', 'Assignment', 'No active setters found - cannot assign');
    return {
      leads,
      users,
      summary: {
        totalAssigned: 0,
        totalSkipped: assignableLeads.length,
        byUser: {},
        errors: ['No active setters with home locations'],
      },
    };
  }

  // Initialize assignment tracking
  const leadUpdates: Lead[] = [];
  const userUpdates: User[] = users.map(user => ({ ...user }));
  const assignmentResults: AssignmentResult[] = [];
  const errors: string[] = [];

  // Process each lead
  for (const lead of assignableLeads) {
    if (!lead.lat || !lead.lng) {
      log('WARN', 'Assignment', 'Skipping lead without coordinates', { lead: lead.name });
      errors.push(`No coordinates for ${lead.name}`);
      continue;
    }

    // Find best setter
    let bestSetter: User | null = null;
    let bestScore = Infinity;
    let bestDistance = 0;

    for (const setter of activeSetters) {
      if (!setter.homeLat || !setter.homeLng) continue;

      const distance = calculateDistance(
        lead.lat, lead.lng,
        setter.homeLat, setter.homeLng
      );

      if (distance > maxDistance) continue;

      const score = calculateAssignmentScore(lead, setter, activeSetters, distance);

      if (score < bestScore) {
        bestScore = score;
        bestSetter = setter;
        bestDistance = distance;
      }
    }

    if (bestSetter) {
      const updatedLead = {
        ...lead,
        assignedTo: bestSetter.id,
        assignedToName: bestSetter.name,
        assignedAt: new Date(),
        autoAssigned: true,
        status: 'claimed' as const,
        claimedBy: bestSetter.id,
        claimedAt: new Date(),
      };

      leadUpdates.push(updatedLead);

      // Update setter's count
      const setterIndex = userUpdates.findIndex(u => u.id === bestSetter!.id);
      if (setterIndex >= 0) {
        userUpdates[setterIndex] = {
          ...userUpdates[setterIndex],
          assignedLeadCount: (userUpdates[setterIndex].assignedLeadCount || 0) + 1,
        };
      }

      assignmentResults.push({
        leadId: lead.id,
        leadName: lead.name,
        leadAddress: `${lead.address}, ${lead.city}`,
        assignedToId: bestSetter.id,
        assignedToName: bestSetter.name,
        distance: bestDistance,
        reason: 'Best match by distance + solar quality + workload',
      });
    } else {
      errors.push(`No setter within ${maxDistance}mi of ${lead.address}`);
    }
  }

  // Build summary by user
  const byUser: Record<string, { count: number; leads: AssignmentResult[] }> = {};
  assignmentResults.forEach(result => {
    if (!byUser[result.assignedToId]) {
      byUser[result.assignedToId] = { count: 0, leads: [] };
    }
    byUser[result.assignedToId].count++;
    byUser[result.assignedToId].leads.push(result);
  });

  const summary: AssignmentSummary = {
    totalAssigned: assignmentResults.length,
    totalSkipped: errors.length,
    byUser,
    errors,
  };

  const elapsed = Date.now() - startTime;
  log('INFO', 'Assignment', `Auto-assignment complete in ${elapsed}ms`, { 
    assigned: assignmentResults.length,
    skipped: errors.length,
    byUser: Object.keys(byUser).length 
  });

  // Apply updates (or not if dry run)
  const finalLeads = dryRun 
    ? leads 
    : leads.map(lead => {
        const update = leadUpdates.find(u => u.id === lead.id);
        return update || lead;
      });

  return {
    leads: finalLeads,
    users: userUpdates,
    summary,
  };
}

// ============================================
// STALE LEAD REASSIGNMENT
// ============================================

export interface ReassignOptions {
  staleDays?: number;
  maxDistance?: number;
  dryRun?: boolean;
}

export interface ReassignResult {
  leads: Lead[];
  users: User[];
  summary: AssignmentSummary;
}

/**
 * Reassign leads that haven't been worked
 */
export function reassignStaleLeads(
  leads: Lead[],
  users: User[],
  options: ReassignOptions = {}
): ReassignResult {
  const startTime = Date.now();
  
  log('INFO', 'Assignment', 'Starting stale lead reassignment', { options });

  const { staleDays = 5, maxDistance = 50, dryRun = false } = options;

  const staleLeads = getStaleLeads(leads, staleDays);
  
  log('INFO', 'Assignment', `Found ${staleLeads.length} stale leads to reassign`);

  if (staleLeads.length === 0) {
    return {
      leads,
      users,
      summary: {
        totalAssigned: 0,
        totalSkipped: 0,
        byUser: {},
        errors: [],
      },
    };
  }

  // Get active setters (excluding original setter)
  const activeSetters = users.filter(user => 
    user.isActive !== false && 
    user.homeLat && 
    user.homeLng
  );

  const leadUpdates: Lead[] = [];
  const userUpdates: User[] = users.map(user => ({ ...user }));
  const assignmentResults: AssignmentResult[] = [];
  const errors: string[] = [];

  for (const lead of staleLeads) {
    const originalSetter = lead.assignedTo;

    // Find best setter (not the original)
    let bestSetter: User | null = null;
    let bestScore = Infinity;
    let bestDistance = 0;

    for (const setter of activeSetters) {
      if (setter.id === originalSetter) continue;
      if (!setter.homeLat || !setter.homeLng) continue;

      const distance = calculateDistance(
        lead.lat!, lead.lng!,
        setter.homeLat, setter.homeLng
      );

      if (distance > maxDistance) continue;

      const score = calculateAssignmentScore(lead, setter, activeSetters, distance);

      if (score < bestScore) {
        bestScore = score;
        bestSetter = setter;
        bestDistance = distance;
      }
    }

    if (bestSetter) {
      const updatedLead = {
        ...lead,
        assignedTo: bestSetter.id,
        assignedToName: bestSetter.name,
        assignedAt: new Date(),
        autoAssigned: true,
        lastAssignedTo: lead.assignedTo,
      };

      leadUpdates.push(updatedLead);

      // Update setter's count
      const setterIndex = userUpdates.findIndex(u => u.id === bestSetter.id);
      if (setterIndex >= 0) {
        userUpdates[setterIndex] = {
          ...userUpdates[setterIndex],
          assignedLeadCount: (userUpdates[setterIndex].assignedLeadCount || 0) + 1,
        };
      }

      assignmentResults.push({
        leadId: lead.id,
        leadName: lead.name,
        leadAddress: `${lead.address}, ${lead.city}`,
        assignedToId: bestSetter.id,
        assignedToName: bestSetter.name,
        distance: bestDistance,
        reason: 'Stale lead reassignment',
      });
    } else {
      errors.push(`No alternate setter within ${maxDistance}mi of ${lead.address}`);
    }
  }

  // Build summary
  const byUser: Record<string, { count: number; leads: AssignmentResult[] }> = {};
  assignmentResults.forEach(result => {
    if (!byUser[result.assignedToId]) {
      byUser[result.assignedToId] = { count: 0, leads: [] };
    }
    byUser[result.assignedToId].count++;
    byUser[result.assignedToId].leads.push(result);
  });

  const summary: AssignmentSummary = {
    totalAssigned: assignmentResults.length,
    totalSkipped: errors.length,
    byUser,
    errors,
  };

  const elapsed = Date.now() - startTime;
  log('INFO', 'Assignment', `Reassignment complete in ${elapsed}ms`, summary);

  const finalLeads = dryRun 
    ? leads 
    : leads.map(lead => {
        const update = leadUpdates.find(u => u.id === lead.id);
        return update || lead;
      });

  return {
    leads: finalLeads,
    users: userUpdates,
    summary,
  };
}

// ============================================
// PREVIEW MODE
// ============================================

export function previewAssignments(
  leads: Lead[],
  users: User[],
  options: AutoAssignOptions = {}
): AssignmentSummary {
  log('INFO', 'Assignment', 'Generating assignment preview');

  const result = autoAssignLeads(leads, users, { ...options, dryRun: true });
  
  return result.summary;
}

// ============================================
// SCORING HELPERS
// ============================================

/**
 * Calculate assignment score for a lead-setter pair
 * Lower is better (optimizes for closest distance)
 */
function calculateAssignmentScore(
  lead: Lead,
  setter: User,
  allSetters: User[],
  distance: number
): number {
  // Base score is distance (0-50 normalized to 0-100)
  const distanceScore = (distance / 50) * 100;

  // Solar quality bonus (better leads get slight priority)
  const solarBonus = getSolarBonus(lead);

  // Workload penalty - prevent any setter from being overloaded
  const workloadPenalty = getWorkloadPenalty(setter, allSetters);

  // Final score
  return distanceScore - solarBonus + workloadPenalty;
}

/**
 * Bonus for high-quality solar leads (negative = better score = higher priority)
 */
function getSolarBonus(lead: Lead): number {
  switch (lead.solarCategory) {
    case 'great': return 10;  // Slight priority for great leads
    case 'good': return 5;
    case 'solid': return 0;
    case 'poor': return -20;  // Deprioritize poor leads
    default: return 0;
  }
}

/**
 * Penalty for overloaded setters
 */
function getWorkloadPenalty(setter: User, allSetters: User[]): number {
  const currentCount = setter.assignedLeadCount || 0;
  
  // Get average count across all active users
  const avgCount = allSetters.reduce((sum, u) => sum + (u.assignedLeadCount || 0), 0) / allSetters.length;
  const diff = currentCount - avgCount;
  
  // If >20 leads ahead, heavy penalty
  if (diff > 20) {
    return 100; // Effectively disqualifies this setter
  }
  
  // Gradual penalty for being ahead
  if (diff > 0) {
    return diff * 2;
  }
  
  return 0;
}

// ============================================
// USER STATISTICS
// ============================================

export interface UserAssignmentStats {
  total: number;
  claimed: number;
  dispositioned: number;
  stale: number;
}

/**
 * Get assignment statistics for a specific user
 */
export function getUserAssignmentStats(
  leads: Lead[],
  userId: string,
  staleDays: number = 5
): UserAssignmentStats {
  const userLeads = leads.filter(lead => 
    lead.assignedTo === userId || lead.claimedBy === userId
  );

  return {
    total: userLeads.length,
    claimed: userLeads.filter(l => l.status === 'claimed').length,
    dispositioned: userLeads.filter(l => l.dispositionedAt).length,
    stale: getStaleLeads(userLeads, staleDays).length,
  };
}
