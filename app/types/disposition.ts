// Custom Disposition System
export interface Disposition {
  id: string;
  name: string;
  color: string; // Hex color for map pin
  icon: string; // Icon name from Lucide
  countsAsDoorKnock: boolean; // Track for metrics
  order: number; // Display order
  isDefault: boolean; // Can't be deleted
  specialBehavior?: 'scheduling-manager' | 'none'; // Custom actions
  createdAt: Date;
  updatedAt: Date;
}

// Default dispositions (backwards compatibility)
export const DEFAULT_DISPOSITIONS: Disposition[] = [
  {
    id: 'unclaimed',
    name: 'Available',
    color: '#22c55e', // Green
    icon: 'circle',
    countsAsDoorKnock: false,
    order: 0,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'claimed',
    name: 'My Targets',
    color: '#f59e0b', // Orange
    icon: 'target',
    countsAsDoorKnock: false,
    order: 1,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'not-home',
    name: 'Not Home',
    color: '#6b7280', // Gray
    icon: 'home',
    countsAsDoorKnock: true,
    order: 2,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'interested',
    name: 'Interested',
    color: '#3b82f6', // Blue
    icon: 'star',
    countsAsDoorKnock: true,
    order: 3,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'not-interested',
    name: 'Not Interested',
    color: '#ef4444', // Red
    icon: 'x-circle',
    countsAsDoorKnock: true,
    order: 4,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'appointment',
    name: 'Appointment Set',
    color: '#8b5cf6', // Purple
    icon: 'calendar',
    countsAsDoorKnock: true,
    order: 5,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'sale',
    name: 'Sale!',
    color: '#10b981', // Emerald
    icon: 'check-circle',
    countsAsDoorKnock: true,
    order: 6,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'go-back',
    name: 'Go Back',
    color: '#f59e0b', // Amber
    icon: 'clock',
    countsAsDoorKnock: true,
    order: 7,
    isDefault: true,
    specialBehavior: 'scheduling-manager',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'house-for-sale',
    name: 'House for Sale',
    color: '#0ea5e9', // Sky — distinct from Go Back amber
    icon: 'dollar-sign',
    countsAsDoorKnock: true,
    order: 8,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export const GO_BACK_DISPOSITION_ID = 'go-back';
export const HOUSE_FOR_SALE_DISPOSITION_ID = 'house-for-sale';

/** Knock statuses that should remain visible even without strong solar data. */
export const KNOCK_STATUS_IDS = [
  'not-home',
  'interested',
  'not-interested',
  'appointment',
  'sale',
  'dq-credit',
  'shade-dq',
  'follow-up-later',
  'renter',
  GO_BACK_DISPOSITION_ID,
  HOUSE_FOR_SALE_DISPOSITION_ID,
] as const;

/** Dispositions that schedule a return visit and appear on Go Backs. */
export const SCHEDULED_GO_BACK_STATUS_IDS = [
  GO_BACK_DISPOSITION_ID,
  HOUSE_FOR_SALE_DISPOSITION_ID,
] as const;

export function isKnockStatus(status?: string | null): boolean {
  return !!status && (KNOCK_STATUS_IDS as readonly string[]).includes(status);
}

export function isScheduledGoBackStatus(status?: string | null): boolean {
  return !!status && (SCHEDULED_GO_BACK_STATUS_IDS as readonly string[]).includes(status);
}

export function getDefaultDispositionLabel(id?: string | null): string {
  if (!id) return '';
  return DEFAULT_DISPOSITIONS.find((d) => d.id === id)?.name || id;
}

export function getDefaultDispositionColor(id?: string | null): string {
  if (!id) return '#6b7280';
  return DEFAULT_DISPOSITIONS.find((d) => d.id === id)?.color || '#6b7280';
}

export function isScheduledGoBackLead(lead: {
  status?: string;
  goBackScheduledDate?: Date | string | null;
}): boolean {
  return isScheduledGoBackStatus(lead.status) && !!lead.goBackScheduledDate;
}

/** Add any missing built-in defaults (by id or display name) without overwriting custom ones. */
export function mergeMissingDefaultDispositions(existing: Disposition[]): Disposition[] {
  const ids = new Set(existing.map((d) => d.id));
  const names = new Set(existing.map((d) => d.name.toLowerCase()));
  const missing = DEFAULT_DISPOSITIONS.filter(
    (d) => !ids.has(d.id) && !names.has(d.name.toLowerCase())
  );
  if (missing.length === 0) return existing;
  return [...existing, ...missing].sort((a, b) => a.order - b.order);
}

export function findMissingDefaultDispositions(existing: Disposition[]): Disposition[] {
  const ids = new Set(existing.map((d) => d.id));
  const names = new Set(existing.map((d) => d.name.toLowerCase()));
  return DEFAULT_DISPOSITIONS.filter(
    (d) => !ids.has(d.id) && !names.has(d.name.toLowerCase())
  );
}

// Available Lucide icons for dispositions
export const AVAILABLE_ICONS = [
  'circle',
  'target',
  'home',
  'star',
  'x-circle',
  'check-circle',
  'calendar',
  'phone',
  'mail',
  'user',
  'users',
  'clock',
  'alert-circle',
  'help-circle',
  'thumbs-up',
  'thumbs-down',
  'flag',
  'bookmark',
  'heart',
  'map-pin',
  'door-open',
  'door-closed',
  'bell',
  'message-square',
  'file-text',
  'clipboard',
  'dollar-sign',
  'zap',
  'sun',
  'cloud',
  'umbrella',
  'car',
  'truck',
  'building',
  'briefcase',
  'coffee',
  'gift',
  'shield',
  'lock',
  'unlock',
  'key',
  'trash',
  'archive',
  'ban',
  'slash',
  'minus-circle',
  'plus-circle',
  'info',
  'x',
  'check',
  'arrow-right',
  'arrow-left',
];

// Color palette for disposition picker
export const DISPOSITION_COLORS = [
  { name: 'Red', hex: '#EF4444' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Lime', hex: '#84CC16' },
  { name: 'Green', hex: '#22C55E' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Purple', hex: '#A855F7' },
  { name: 'Fuchsia', hex: '#D946EF' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Gray', hex: '#6B7280' },
  { name: 'Slate', hex: '#64748B' },
  { name: 'Zinc', hex: '#71717A' },
];
