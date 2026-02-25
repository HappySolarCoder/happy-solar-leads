// User color utilities for territory visualization

// 30 bright, highly visible colors optimized for satellite imagery
// Avoids dark colors that blend with terrain
const TERRITORY_COLORS = [
  '#FF0000', // Bright Red
  '#00FFFF', // Cyan
  '#FF00FF', // Magenta
  '#FFFF00', // Yellow
  '#00FF00', // Lime
  '#FF6600', // Orange
  '#FF0099', // Hot Pink
  '#0099FF', // Sky Blue
  '#FF3366', // Rose
  '#00FF99', // Spring Green
  '#9966FF', // Purple
  '#FF9900', // Tangerine
  '#FF33CC', // Pink
  '#33CCFF', // Light Blue
  '#CCFF00', // Yellow-Green
  '#FF3333', // Scarlet
  '#33FF33', // Green
  '#3399FF', // Azure
  '#FF6699', // Pink Rose
  '#66FF33', // Chartreuse
  '#FF9933', // Orange Yellow
  '#9933FF', // Violet
  '#33FFCC', // Turquoise
  '#FFCC00', // Gold
  '#FF0066', // Deep Pink
  '#66CCFF', // Cornflower
  '#CCFF33', // Lime Yellow
  '#FF3399', // Raspberry
  '#33FF99', // Sea Green
  '#FF6633', // Coral
];

/**
 * Get a default color for a user based on their index
 */
export function getDefaultUserColor(index: number): string {
  return TERRITORY_COLORS[index % TERRITORY_COLORS.length];
}

/**
 * Ensure all users have colors assigned
 * Auto-fixes colors not in the bright palette
 */
export function ensureUserColors(users: any[]): any[] {
  return users.map((user, index) => {
    // If user has no color OR color not in bright palette, reassign
    const hasValidColor = user.color && TERRITORY_COLORS.includes(user.color.toUpperCase());
    
    return {
      ...user,
      color: hasValidColor ? user.color : getDefaultUserColor(index),
    };
  });
}
