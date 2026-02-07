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
  lat: number;
  lng: number;
  status: LeadStatus;
  claimedBy?: string; // User ID
  claimedAt?: Date;
  dispositionedAt?: Date;
  notes?: string;
  source?: string; // Where this lead came from
  createdAt: Date;
}

export interface CSVRow {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  email?: string;
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
