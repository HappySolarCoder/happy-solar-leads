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

/**
 * Display-only formatter for stored go-back clock times.
 *
 * `goBackScheduledTime` is a wall-clock string (HTML `<input type="time">`
 * typically saves "HH:mm" or "HH:mm:ss"). That string is already the intended
 * America/New_York clock time. Do not run it through Date + timeZone conversion
 * — that would shift hours on UTC hosts and change the scheduled clock time.
 *
 * Examples: "18:25" → "6:25pm", "10:30" → "10:30am".
 */
export function formatGoBackScheduledTime(time?: string | null): string {
  if (!time) return '';
  const trimmed = time.trim();
  if (!trimmed) return '';

  const withMeridiem = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
  if (withMeridiem) {
    const hour = parseInt(withMeridiem[1], 10);
    const minute = withMeridiem[2];
    const meridiem = withMeridiem[3].toLowerCase();
    if (hour >= 1 && hour <= 12) {
      return `${hour}:${minute}${meridiem}`;
    }
  }

  const twentyFour = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFour) {
    const hour24 = parseInt(twentyFour[1], 10);
    const minute = twentyFour[2];
    if (hour24 >= 0 && hour24 <= 23) {
      const meridiem = hour24 >= 12 ? 'pm' : 'am';
      const hour12 = hour24 % 12 || 12;
      return `${hour12}:${minute}${meridiem}`;
    }
  }

  return trimmed;
}
