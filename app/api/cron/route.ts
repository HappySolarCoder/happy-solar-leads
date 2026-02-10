// Cron Job API Endpoint
// POST /api/cron - Run daily lead management tasks
//
// For Vercel Cron Jobs, add to vercel.json:
// {
//   "crons": [{
//     "path": "/api/cron",
//     "schedule": "0 6 * * *"
//   }]
// }
//
// Note: Since this MVP uses localStorage (client-side),
// the cron endpoint accepts leads/users in the request body.
// In a production app with a database, this would query directly.

import { NextRequest, NextResponse } from 'next/server';
import { runDailyCron, formatCronSummary, DailyCronResult } from '@/app/cron/daily';
import { Lead, User } from '@/app/types';

export interface CronRequest {
  leads: Lead[];
  users: User[];
  options?: {
    staleDays?: number;
    maxDistance?: number;
    dryRun?: boolean;
    sendNotifications?: boolean;
  };
}

export interface CronResponse {
  success: boolean;
  result?: DailyCronResult;
  summary?: string;
  updatedLeads?: Lead[];
  error?: string;
}

// Verify cron request is authorized (for Vercel Cron Jobs)
function verifyCronAuth(request: NextRequest): boolean {
  // Vercel sends this header for cron jobs
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // If no secret configured, allow all (dev mode)
  if (!cronSecret) return true;

  // Check bearer token
  if (authHeader === `Bearer ${cronSecret}`) return true;

  // Check Vercel's cron header
  const vercelCron = request.headers.get('x-vercel-cron');
  if (vercelCron) return true;

  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse<CronResponse>> {
  try {
    // Check authorization
    if (!verifyCronAuth(request)) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized',
      }, { status: 401 });
    }

    const body: CronRequest = await request.json();
    const { leads, users, options = {} } = body;

    // Validate input
    if (!leads || !Array.isArray(leads)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid leads array',
      }, { status: 400 });
    }

    if (!users || !Array.isArray(users)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid users array',
      }, { status: 400 });
    }

    // Parse dates
    const parsedLeads = leads.map(lead => ({
      ...lead,
      createdAt: new Date(lead.createdAt),
      claimedAt: lead.claimedAt ? new Date(lead.claimedAt) : undefined,
      assignedAt: lead.assignedAt ? new Date(lead.assignedAt) : undefined,
      dispositionedAt: lead.dispositionedAt ? new Date(lead.dispositionedAt) : undefined,
    }));

    const parsedUsers = users.map(user => ({
      ...user,
      createdAt: new Date(user.createdAt),
    }));

    // Run cron job
    const result = await runDailyCron(parsedLeads, parsedUsers, {
      staleDays: options.staleDays || 5,
      maxDistance: options.maxDistance || 50,
      dryRun: options.dryRun || false,
      sendNotifications: options.sendNotifications !== false,
    });

    // Format summary
    const summary = formatCronSummary(result);

    // Log the summary
    console.log('Daily Cron Job Completed:');
    console.log(summary);

    return NextResponse.json({
      success: true,
      result,
      summary,
      updatedLeads: options.dryRun ? undefined : parsedLeads,
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// GET endpoint for manual triggering and status check
export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');

  if (action === 'status') {
    return NextResponse.json({
      name: 'Daily Cron Job',
      schedule: '6:00 AM daily',
      tasks: [
        'Find stale leads (5+ days without disposition)',
        'Reassign stale leads to different setters',
        'Generate performance stats',
        'Send summary notifications',
      ],
      lastRun: null, // Would come from database in production
    });
  }

  if (action === 'trigger') {
    return NextResponse.json({
      message: 'Use POST /api/cron with leads and users to trigger manually',
      example: {
        leads: '[...leads from localStorage]',
        users: '[...users from localStorage]',
        options: {
          staleDays: 5,
          dryRun: true,
        },
      },
    });
  }

  return NextResponse.json({
    endpoints: {
      'GET /api/cron?action=status': 'Check cron job status',
      'GET /api/cron?action=trigger': 'Get trigger instructions',
      'POST /api/cron': 'Run cron job with leads/users data',
    },
  });
}
