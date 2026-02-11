// Custom Disposition System
export interface Disposition {
  id: string;
  name: string;
  color: string; // Hex color for map pin
  icon: string; // Icon name from Lucide
  countsAsDoorKnock: boolean; // Track for metrics
  order: number; // Display order
  isDefault: boolean; // Can't be deleted
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
];

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
