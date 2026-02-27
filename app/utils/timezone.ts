// Timezone utilities for consistent EST/EDT formatting

const EST_TIMEZONE = 'America/New_York';

/**
 * Format a date/time in EST
 */
export function formatTimeEST(date: Date | string | undefined): string {
  if (!date) return '';
  
  let d: Date;
  if (typeof date === 'string') {
    // If string doesn't have timezone info, assume it's UTC
    d = date.includes('Z') ? new Date(date) : new Date(date + 'Z');
  } else {
    d = date;
  }
  
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
  
  let d: Date;
  if (typeof date === 'string') {
    d = date.includes('Z') ? new Date(date) : new Date(date + 'Z');
  } else {
    d = date;
  }
  
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
  
  let d: Date;
  if (typeof date === 'string') {
    d = date.includes('Z') ? new Date(date) : new Date(date + 'Z');
  } else {
    d = date;
  }
  
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
