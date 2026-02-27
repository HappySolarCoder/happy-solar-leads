// Lead and User Types

// LeadStatus is now dynamic - can be any disposition ID from Firestore
export type LeadStatus = string;

// Re-export disposition history types
export type { DispositionHistoryEntry, DispositionHistoryFilters } from './dispositionHistory';

export type UserRole = 
  | 'setter'
  | 'closer'
  | 'manager'
  | 'admin';

export type ApprovalStatus = 'approved' | 'pending';

export interface User {
  id: string;
  name: string;
  email: string;
  color: string; // For map pin color
  role: UserRole; // Current active permission level
  requestedRole?: UserRole; // What they originally asked for
  approved?: boolean; // false if awaiting approval for elevated role
  approvalStatus?: ApprovalStatus;
  approvalRequestedAt?: Date;
  createdAt: Date;
  // Auto-assignment fields
  assignedLeadCount?: number;
  isActive?: boolean; // Can receive auto-assigned leads
  // Optional user metadata
  status?: string;
  lastLogin?: Date;
  // Territory (for lead assignment - DO NOT confuse with Team)
  territory?: string;
  // Team (for user organization - e.g., Rochester, Buffalo)
  team?: string;
}

export type LeadTag = 'solar-data' | 'homeowner' | 'home-data';
export type PropertyType = 'house' | 'apartment' | 'commercial' | 'unknown';

export interface Lead {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  email?: string;
  estimatedBill?: number;  // Monthly electric bill estimate
  setterId?: string;  // User who uploaded/assigned this lead
  lat?: number;
  lng?: number;
  status: LeadStatus;
  claimedBy?: string;
  claimedAt?: Date;
  disposition?: string;       // Disposition name (from dispositions collection)
  dispositionedAt?: Date;
  notes?: string;
  source?: string;
  createdAt: Date;
  // Tags (admin only)
  tags?: LeadTag[];
  // Property type (from Geocoding API)
  propertyType?: PropertyType;
  // Solar data (populated when available)
  solarScore?: number;        // 0-100 score
  solarCategory?: 'poor' | 'solid' | 'good' | 'great';
  solarMaxPanels?: number;
  solarSunshineHours?: number;
  hasSouthFacingRoof?: boolean;
  solarTestedAt?: Date;
  // Auto-assignment fields
  assignedTo?: string;        // Setter ID auto-assigned to
  assignedAt?: Date;          // When auto-assigned
  autoAssigned?: boolean;     // Was this lead auto-assigned?
  lastAssignedTo?: string;    // Previous assignee (for stale reassignment)
  // Objection tracking
  objectionType?: ObjectionType;
  objectionNotes?: string;
  objectionRecordedAt?: Date;
  objectionRecordedBy?: string; // User ID who recorded the objection
  // GPS knock verification
  knockGpsLat?: number;          // GPS latitude when knocked
  knockGpsLng?: number;          // GPS longitude when knocked
  knockGpsAccuracy?: number;     // GPS accuracy in meters
  knockGpsTimestamp?: Date;      // Timestamp of GPS capture
  knockDistanceFromAddress?: number; // Distance from address in meters
  // Easter Eggs
  hasEasterEgg?: boolean;        // HIDDEN - only for hidden pin eggs
  easterEggId?: string;          // Which egg is hidden here
  // Go Back scheduling
  goBackScheduledDate?: Date;    // Scheduled go back date
  goBackScheduledTime?: string;  // Optional time (e.g., "2:00 PM")
  goBackNotes?: string;          // Go back specific notes
  goBackScheduledBy?: string;    // User ID who scheduled it
  // Disposition history (simplified inline tracking)
  dispositionHistory?: LeadDispositionHistoryEntry[];  // Track all disposition changes
  // Photos & Attachments
  photos?: LeadPhoto[];  // Photos attached to this lead
}

export interface LeadPhoto {
  id: string;
  url: string;
  caption?: string;
  type: 'roof' | 'meter' | 'electrical' | 'roofing' | 'other';
  uploadedBy: string;
  uploadedAt: Date;
}

export interface LeadDispositionHistoryEntry {
  disposition: string;      // Disposition name at time of change
  timestamp: Date;          // When the disposition was set
  userId: string;           // User who set the disposition
  userName: string;         // User's name at time (preserved even if user deleted)
}

export type ObjectionType = 
  | 'too-expensive'
  | 'bad-credit'
  | 'roof-issues'
  | 'moving-soon'
  | 'not-owner'
  | 'already-has-solar'
  | 'too-complicated'
  | 'need-to-think'
  | 'not-interested-in-solar'
  | 'other';

export interface CSVRow {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  email?: string;
  estimatedBill?: number;  // Monthly electric bill estimate
}

// DEPRECATED: Use getDispositionsAsync() from utils/dispositions instead
// These are kept for backwards compatibility during migration
export const STATUS_LABELS: Record<string, string> = {
  'unclaimed': 'Available',
  'claimed': 'My Targets',
  'not-home': 'Not Home',
  'interested': 'Interested',
  'not-interested': 'Not Interested',
  'appointment': 'Appointment Set',
  'sale': 'Sale!',
};

// DEPRECATED: Use getDispositionByIdAsync() from utils/dispositions instead
export const STATUS_COLORS: Record<string, string> = {
  'unclaimed': '#22c55e',      // Green
  'claimed': '#f59e0b',        // Orange
  'not-home': '#6b7280',       // Gray
  'interested': '#3b82f6',     // Blue
  'not-interested': '#ef4444', // Red
  'appointment': '#8b5cf6',    // Purple
  'sale': '#10b981',           // Emerald
};

// Get status label based on user role (for managers/admins who see all leads)
// DEPRECATED: Use getDispositionByIdAsync() from utils/dispositions instead
export function getStatusLabel(status: LeadStatus, userRole?: UserRole): string {
  if (status === 'claimed') {
    // Managers and admins see "Claimed" since they view all users' leads
    if (userRole === 'manager' || userRole === 'admin') {
      return 'Claimed';
    }
    // Setters/closers see "My Targets" since they only see their own
    return 'My Targets';
  }
  return STATUS_LABELS[status] || status;
}

export const DEFAULT_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#84cc16', // Lime
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
];

export const OBJECTION_LABELS: Record<ObjectionType, string> = {
  'too-expensive': 'Too Expensive',
  'bad-credit': 'Bad Credit / Financing Concerns',
  'roof-issues': 'Roof Condition Issues',
  'moving-soon': 'Moving Soon',
  'not-owner': 'Not the Homeowner',
  'already-has-solar': 'Already Has Solar',
  'too-complicated': 'Too Complicated / Confusing',
  'need-to-think': 'Need to Think About It',
  'not-interested-in-solar': 'Not Interested in Solar',
  'other': 'Other / Custom Objection',
};

export const OBJECTION_COLORS: Record<ObjectionType, string> = {
  'too-expensive': '#ef4444',           // Red
  'bad-credit': '#f97316',              // Orange
  'roof-issues': '#f59e0b',             // Amber
  'moving-soon': '#a855f7',             // Purple
  'not-owner': '#ec4899',               // Pink
  'already-has-solar': '#6b7280',       // Gray
  'too-complicated': '#06b6d4',         // Cyan
  'need-to-think': '#84cc16',           // Lime
  'not-interested-in-solar': '#ef4444', // Red
  'other': '#9ca3af',                   // Gray-400
};

// User Roles
export const ROLE_LABELS: Record<UserRole, string> = {
  'setter': 'Setter',
  'closer': 'Closer',
  'manager': 'Manager',
  'admin': 'Admin',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  'setter': 'Can use app, see own/unclaimed leads, disposition',
  'closer': 'Same as setter (for tracking purposes)',
  'manager': 'Setter + assign leads + team data',
  'admin': 'Full access: upload, reassign, delete, permissions',
};

// Permission Helpers
export function canUploadLeads(role: UserRole): boolean {
  return role === 'admin';
}

export function canAssignLeads(role: UserRole): boolean {
  return role === 'manager' || role === 'admin';
}

export function canSeeAllLeads(role: UserRole): boolean {
  return role === 'manager' || role === 'admin';
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}

export function canSeeTeamData(role: UserRole): boolean {
  return role === 'manager' || role === 'admin';
}

export function canReassignLeads(role: UserRole): boolean {
  return role === 'admin';
}

export function canDeleteUsers(role: UserRole): boolean {
  return role === 'admin';
}

export function canChangePermissions(role: UserRole): boolean {
  return role === 'admin';
}

export function requiresRoleApproval(role: UserRole): boolean {
  return role === 'manager' || role === 'admin';
}

// Lead Tags
export const LEAD_TAG_LABELS: Record<LeadTag, string> = {
  'solar-data': 'Solar Data Leads',
  'homeowner': 'Homeowner Leads',
  'home-data': 'Home Data Leads',
};

export const LEAD_TAG_COLORS: Record<LeadTag, string> = {
  'solar-data': '#f59e0b',  // Amber - sun/solar
  'homeowner': '#3b82f6',   // Blue - home/property
  'home-data': '#10b981',   // Green - data/info
};

export const LEAD_TAG_DESCRIPTIONS: Record<LeadTag, string> = {
  'solar-data': 'Leads with solar panel analysis and roof data',
  'homeowner': 'Verified homeowner contact information',
  'home-data': 'Property details, square footage, home characteristics',
};
