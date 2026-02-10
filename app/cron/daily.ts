// Daily Cron Job for Lead Management
// Runs at 6 AM daily (configured in vercel.json)
//
// Tasks:
// 1. Find stale leads (not dispositioned in 5+ days)
// 2. Trigger reassignment to different setters
// 3. Send summary notification
//
// Note: This is designed for Vercel Cron Jobs
// See: https://vercel.com/docs/cron-jobs

import { Lead, User } from '@/app/types';
import { getStaleLeads, reassignStaleLeads, getUserAssignmentStats } from '@/app/utils/assignment';

export interface DailyCronResult {
  timestamp: Date;
  staleLeads: {
    count: number;
    reassigned: number;
    details: Array<{
      leadId: string;
      leadName: string;
      fromSetter: string;
      toSetter: string;
      daysStale: number;
    }>;
  };
  userStats: Array<{
    userId: string;
    userName: string;
    totalLeads: number;
    claimed: number;
    dispositioned: number;
    stale: number;
  }>;
  notifications: string[];
}

/**
 * Run the daily cron job
 * 
 * @param leads All leads from storage
 * @param users All setters
 * @param options Configuration
 */
export async function runDailyCron(
  leads: Lead[],
  users: User[],
  options: {
    staleDays?: number;
    maxDistance?: number;
    dryRun?: boolean;
    sendNotifications?: boolean;
  } = {}
): Promise<DailyCronResult> {
  const {
    staleDays = 5,
    maxDistance = 50,
    dryRun = false,
    sendNotifications = true,
  } = options;

  const result: DailyCronResult = {
    timestamp: new Date(),
    staleLeads: {
      count: 0,
      reassigned: 0,
      details: [],
    },
    userStats: [],
    notifications: [],
  };

  // 1. Find stale leads
  const staleLeads = getStaleLeads(leads, staleDays);
  result.staleLeads.count = staleLeads.length;

  if (staleLeads.length > 0) {
    // 2. Reassign stale leads
    const reassignResult = reassignStaleLeads(leads, users, {
      staleDays,
      maxDistance,
      dryRun,
    });

    result.staleLeads.reassigned = reassignResult.summary.totalAssigned;

    // Record details
    for (const staleLead of staleLeads) {
      const assignedDate = staleLead.assignedAt || staleLead.claimedAt;
      const daysStale = assignedDate
        ? Math.floor((Date.now() - new Date(assignedDate).getTime()) / (1000 * 60 * 60 * 24))
        : staleDays;

      // Find who it was reassigned to
      const newAssignment = Object.values(reassignResult.summary.byUser)
        .flatMap(u => u.leads)
        .find(a => a.leadId === staleLead.id);

      result.staleLeads.details.push({
        leadId: staleLead.id,
        leadName: staleLead.name,
        fromSetter: users.find(u => u.id === (staleLead.assignedTo || staleLead.claimedBy))?.name || 'Unknown',
        toSetter: newAssignment?.assignedToName || 'Unassigned',
        daysStale,
      });
    }

    // Update leads array with reassignments
    if (!dryRun) {
      leads.splice(0, leads.length, ...reassignResult.leads);
    }
  }

  // 3. Calculate user stats
  const activeUsers = users.filter(u => u.isActive !== false);
  for (const user of activeUsers) {
    const stats = getUserAssignmentStats(leads, user.id);
    result.userStats.push({
      userId: user.id,
      userName: user.name,
      totalLeads: stats.total,
      claimed: stats.claimed,
      dispositioned: stats.dispositioned,
      stale: stats.stale,
    });
  }

  // 4. Generate notifications
  if (sendNotifications) {
    if (staleLeads.length > 0) {
      result.notifications.push(
        `⚠️ ${staleLeads.length} stale leads found (${staleDays}+ days without disposition)`
      );
      
      if (result.staleLeads.reassigned > 0) {
        result.notifications.push(
          `🔄 ${result.staleLeads.reassigned} leads reassigned to new setters`
        );
      }
    }

    // Highlight overloaded setters
    const overloaded = result.userStats.filter(s => s.claimed > 20);
    if (overloaded.length > 0) {
      result.notifications.push(
        `📊 ${overloaded.length} setter(s) have 20+ active leads`
      );
    }

    // Highlight top performers
    const topPerformers = result.userStats
      .filter(s => s.dispositioned > 5)
      .sort((a, b) => b.dispositioned - a.dispositioned)
      .slice(0, 3);
    
    if (topPerformers.length > 0) {
      result.notifications.push(
        `🏆 Top performers: ${topPerformers.map(p => `${p.userName} (${p.dispositioned} closed)`).join(', ')}`
      );
    }
  }

  return result;
}

/**
 * Format cron result for display or logging
 */
export function formatCronSummary(result: DailyCronResult): string {
  const lines: string[] = [
    `📅 Daily Lead Report - ${result.timestamp.toLocaleDateString()}`,
    '',
  ];

  // Stale leads section
  if (result.staleLeads.count > 0) {
    lines.push(`⚠️ Stale Leads: ${result.staleLeads.count}`);
    lines.push(`   Reassigned: ${result.staleLeads.reassigned}`);
    
    if (result.staleLeads.details.length > 0) {
      lines.push('   Details:');
      for (const detail of result.staleLeads.details.slice(0, 5)) {
        lines.push(`   - ${detail.leadName}: ${detail.fromSetter} → ${detail.toSetter} (${detail.daysStale} days)`);
      }
      if (result.staleLeads.details.length > 5) {
        lines.push(`   ... and ${result.staleLeads.details.length - 5} more`);
      }
    }
    lines.push('');
  }

  // User stats
  lines.push('👥 Setter Stats:');
  for (const stat of result.userStats) {
    const status = stat.stale > 0 ? '⚠️' : '✅';
    lines.push(`   ${status} ${stat.userName}: ${stat.claimed} active, ${stat.dispositioned} closed, ${stat.stale} stale`);
  }
  lines.push('');

  // Notifications
  if (result.notifications.length > 0) {
    lines.push('📢 Notifications:');
    for (const note of result.notifications) {
      lines.push(`   ${note}`);
    }
  }

  return lines.join('\n');
}

/**
 * Check if we should run (based on last run time)
 * Prevents double-runs if cron fires multiple times
 */
export function shouldRunCron(lastRunTime: Date | null, minHoursBetweenRuns: number = 20): boolean {
  if (!lastRunTime) return true;
  
  const hoursSinceLastRun = (Date.now() - lastRunTime.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastRun >= minHoursBetweenRuns;
}
