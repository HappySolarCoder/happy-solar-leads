// Client-side logger that writes to server endpoint for persistence
// Add this to any component: const log = require('./logger-client')('component-name');

const LOG_ENDPOINT = '/api/log';

module.exports = function(component) {
  function write(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      data,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    };

    // Log to console
    console[level.toLowerCase()](`[${level}] [${component}] ${message}`, data);

    // Try to send to server endpoint
    if (typeof fetch !== 'undefined') {
      fetch(LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {}); // Silent fail
    }
  }

  return {
    debug: (msg, data) => write('DEBUG', msg, data),
    info: (msg, data) => write('INFO', msg, data),
    warn: (msg, data) => write('WARN', msg, data),
    error: (msg, data) => write('ERROR', msg, data),
  };
};
