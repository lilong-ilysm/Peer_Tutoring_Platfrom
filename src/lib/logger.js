/**
 * Minimal structured logger.
 *
 * One line per event, machine-greppable, and deliberately free of personal
 * data: identifiers only, never names, emails or message bodies.
 */
import config from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = LEVELS[config.isTest ? 'error' : config.isProduction ? 'info' : 'debug'];

function emit(level, message, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), message];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${key}=${text}`);
  }
  const line = parts.join(' ');
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message, fields) => emit('debug', message, fields),
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
  /** Log an unexpected fault with its stack, keeping it out of the response. */
  fault: (error, fields = {}) => {
    emit('error', error?.message || 'Unhandled error', fields);
    if (error?.stack && !config.isTest) process.stderr.write(`${error.stack}\n`);
  },
};

export default logger;
