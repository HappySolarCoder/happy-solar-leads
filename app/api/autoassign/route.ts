// Auto-Assignment API Endpoint
// POST /api/autoassign - Trigger automatic lead distribution

import { NextRequest, NextResponse } from 'next/server';
import {
  autoAssignLeads,
  reassignStaleLeads,
  previewAssignments,
  getStaleLeads,
  AssignmentSummary,
} from '@/app/utils/assignment';
import { Lead, User } from '@/app/types';

export interface AutoAssignRequest {
  // Leads to process (from client localStorage)
  leads: Lead[];
  // Available setters
  users: User[];
  // Options
  options?: {
    maxDistance?: number;           // Max miles from setter home (default: 50)
    onlyCategories?: Array<'poor' | 'solid' | 'good' | 'great'>;
    reassignStale?: boolean;        // Also reassign stale leads
    staleDays?: number;             // Days until lead is considered stale (default: 5)
    preview?: boolean;              // Just preview, don't modify
  };
}

export interface AutoAssignResponse {
  success: boolean;
  // Updated data (if not preview)
  leads?: Lead[];
  users?: User[];
  // Assignment summary
  summary: AssignmentSummary;
  // Stale lead info
  staleLeads?: {
    count: number;
    leads: Array<{ id: string; name: string; address: string; daysStale: number }>;
  };
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<AutoAssignResponse>> {
  try {
    const body: AutoAssignRequest = await request.json();
    const { leads, users, options = {} } = body;

    // Validate input
    if (!leads || !Array.isArray(leads)) {
      return NextResponse.json({
        success: false,
        summary: {
          totalAssigned: 0,
          totalSkipped: 0,
          byUser: {},
          errors: ['Invalid leads array'],
        },
        error: 'Invalid leads array',
      }, { status: 400 });
    }

    if (!users || !Array.isArray(users)) {
      return NextResponse.json({
        success: false,
        summary: {
          totalAssigned: 0,
          totalSkipped: 0,
          byUser: {},
          errors: ['Invalid users array'],
        },
        error: 'Invalid users array',
      }, { status: 400 });
    }

    const {
      maxDistance = 50,
      onlyCategories,
      reassignStale = false,
      staleDays = 5,
      preview = false,
    } = options;

    // Parse dates and coordinates back from JSON
    const parsedLeads = leads.map(lead => ({
      ...lead,
      lat: lead.lat ? parseFloat(lead.lat.toString()) : undefined,
      lng: lead.lng ? parseFloat(lead.lng.toString()) : undefined,
      createdAt: new Date(lead.createdAt),
      claimedAt: lead.claimedAt ? new Date(lead.claimedAt) : undefined,
      assignedAt: lead.assignedAt ? new Date(lead.assignedAt) : undefined,
      dispositionedAt: lead.dispositionedAt ? new Date(lead.dispositionedAt) : undefined,
      solarTestedAt: lead.solarTestedAt ? new Date(lead.solarTestedAt) : undefined,
    }));

    const parsedUsers = users.map(user => ({
      ...user,
      createdAt: new Date(user.createdAt),
    }));

    console.log('[AutoAssign API] Leads received:', leads.length);
    console.log('[AutoAssign API] Leads with coordinates:', leads.filter(l => l.lat && l.lng).length);

    // Check for stale leads
    const staleLeadsList = getStaleLeads(parsedLeads, staleDays);
    const staleLeadsInfo = {
      count: staleLeadsList.length,
      leads: staleLeadsList.map(lead => {
        const assignedDate = lead.assignedAt || lead.claimedAt;
        const daysStale = assignedDate 
          ? Math.floor((Date.now() - new Date(assignedDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          id: lead.id,
          name: lead.name,
          address: `${lead.address}, ${lead.city}`,
          daysStale,
        };
      }),
    };

    // Handle stale lead reassignment
    if (reassignStale && staleLeadsList.length > 0) {
      const result = reassignStaleLeads(parsedLeads, parsedUsers, {
        staleDays,
        maxDistance,
        dryRun: preview,
      });

      return NextResponse.json({
        success: true,
        leads: preview ? undefined : result.leads,
        users: preview ? undefined : result.users,
        summary: result.summary,
        staleLeads: staleLeadsInfo,
      });
    }

    // Regular auto-assignment
    const result = autoAssignLeads(parsedLeads, parsedUsers, {
      maxDistance,
      onlyCategories,
      onlyUnclaimed: true,
      dryRun: preview,
    });

    return NextResponse.json({
      success: true,
      leads: preview ? undefined : result.leads,
      users: preview ? undefined : result.users,
      summary: result.summary,
      staleLeads: staleLeadsInfo,
    });

  } catch (error) {
    console.error('Auto-assign error:', error);
    return NextResponse.json({
      success: false,
      summary: {
        totalAssigned: 0,
        totalSkipped: 0,
        byUser: {},
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// GET endpoint for previewing assignments and stale leads
export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');

  if (action === 'info') {
    return NextResponse.json({
      name: 'Auto-Assignment API',
      version: '1.0.0',
      endpoints: {
        'POST /api/autoassign': {
          description: 'Auto-assign leads to setters',
          body: {
            leads: 'Lead[] - All leads from storage',
            users: 'User[] - All setters',
            options: {
              maxDistance: 'number (default: 50) - Max miles from setter home',
              onlyCategories: "['solid', 'good', 'great'] - Filter by solar category",
              reassignStale: 'boolean - Also reassign stale leads',
              staleDays: 'number (default: 5) - Days until lead is stale',
              preview: 'boolean - Preview only, no changes',
            },
          },
        },
      },
    });
  }

  return NextResponse.json({
    message: 'Use POST to trigger auto-assignment, or GET ?action=info for API docs',
  });
}
