// Logger utility for Happy Solar Leads
// Usage: const log = require('./logger')('happy-solar');

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

module.exports = function(appName) {
  // Ensure logs directory exists
  const appLogDir = path.join(LOGS_DIR, appName);
  if (!fs.existsSync(appLogDir)) {
    fs.mkdirSync(appLogDir, { recursive: true });
  }

  function write(level, component, message, data = {}) {
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const logPath = path.join(appLogDir, `${dateStr}.log`);
    
    const entry = `[${timestamp}] [${level}] [${appName}] [${component}] ${message} | ${JSON.stringify(data)}\n`;
    
    try {
      fs.appendFileSync(logPath, entry);
    } catch (e) {
      console.error('Logger error:', e.message);
    }
  }

  return {
    debug: (component, message, data) => write('DEBUG', component, message, data),
    info:  (component, message, data) => write('INFO', component, message, data),
    warn:  (component, message, data) => write('WARN', component, message, data),
    error: (component, message, data) => write('ERROR', component, message, data),
  };
};
