// Timezone utilities for consistent EST/EDT formatting

const EST_TIMEZONE = 'America/New_York';

/**
 * Format a date/time in EST
 */
export function formatTimeEST(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', { 
    timeZone: EST_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true 
  });
}

/**
 * Format a date in EST
 */
export function formatDateEST(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { 
    timeZone: EST_TIMEZONE,
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format date and time in EST
 */
export function formatDateTimeEST(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', { 
    timeZone: EST_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
