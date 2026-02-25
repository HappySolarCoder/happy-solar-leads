// User color utilities for territory visualization

// Vibrant, distinct colors for territory visualization
const TERRITORY_COLORS = [
  '#EF4444', // Red
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#6366F1', // Indigo
  '#84CC16', // Lime
  '#06B6D4', // Cyan
  '#D946EF', // Fuchsia
  '#EAB308', // Yellow
  '#A855F7', // Violet
  '#22C55E', // Emerald
];

/**
 * Get a default color for a user based on their index
 */
export function getDefaultUserColor(index: number): string {
  return TERRITORY_COLORS[index % TERRITORY_COLORS.length];
}

/**
 * Ensure all users have colors assigned
 */
export function ensureUserColors(users: any[]): any[] {
  return users.map((user, index) => ({
    ...user,
    color: user.color || getDefaultUserColor(index),
  }));
}
