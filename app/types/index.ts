// Lead and User Types

export type LeadStatus = 
  | 'unclaimed'
  | 'claimed'
  | 'not-home'
  | 'interested'
  | 'not-interested'
  | 'appointment'
  | 'sale';

export interface User {
  id: string;
  name: string;
  email: string;
  color: string; // For map pin color
  createdAt: Date;
  // Auto-assignment fields
  homeAddress?: string;
  homeLat?: number;
  homeLng?: number;
  assignedLeadCount?: number;
  isActive?: boolean; // Can receive auto-assigned leads
  // Optional user metadata
  role?: string;
  status?: string;
  lastLogin?: Date;
}

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
  dispositionedAt?: Date;
  notes?: string;
  source?: string;
  createdAt: Date;
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
}

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

export const STATUS_LABELS: Record<LeadStatus, string> = {
  'unclaimed': 'Unclaimed',
  'claimed': 'Claimed',
  'not-home': 'Not Home',
  'interested': 'Interested',
  'not-interested': 'Not Interested',
  'appointment': 'Appointment Set',
  'sale': 'Sale!',
};

export const STATUS_COLORS: Record<LeadStatus, string> = {
  'unclaimed': '#22c55e',      // Green
  'claimed': '#f59e0b',        // Orange
  'not-home': '#6b7280',       // Gray
  'interested': '#3b82f6',     // Blue
  'not-interested': '#ef4444', // Red
  'appointment': '#8b5cf6',    // Purple
  'sale': '#10b981',           // Emerald
};

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
