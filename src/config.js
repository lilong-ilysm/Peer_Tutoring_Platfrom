/**
 * Application configuration.
 *
 * Values come from the environment. A minimal .env parser is used so the app
 * keeps zero runtime dependencies. Real secrets must never be committed:
 * `.env` is git-ignored and `.env.example` documents the shape.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the project root (the folder containing package.json). */
export const ROOT = path.resolve(here, '..');

/**
 * Load KEY=VALUE pairs from a dotenv-style file without overriding anything
 * already present in process.env (real environment always wins).
 */
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip a trailing inline comment when the value is not quoted.
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;

function str(key, fallback) {
  const value = env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Configuration error: ${key} must be an integer (received "${raw}")`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`Configuration error: ${key} must be between ${min} and ${max}`);
  }
  return parsed;
}

function bool(key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function assertTimezone(zone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    throw new Error(`Configuration error: APP_TIMEZONE "${zone}" is not a recognised IANA timezone`);
  }
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const sessionSecret = str('SESSION_SECRET', isProduction ? '' : 'dev-only-insecure-secret-change-me');
if (isProduction && sessionSecret.length < 32) {
  throw new Error(
    'Configuration error: SESSION_SECRET must be set to at least 32 characters when NODE_ENV=production'
  );
}

const databaseFileRaw = str('DATABASE_FILE', path.join('data', 'peerlearn.db'));

export const config = {
  env: nodeEnv,
  isProduction,
  isTest,
  appName: str('APP_NAME', 'PeerLearn'),
  currencySymbol: str('CURRENCY_SYMBOL', '$').slice(0, 3),
  host: str('HOST', '127.0.0.1'),
  port: int('PORT', 3000, { min: 0, max: 65535 }),
  sessionSecret,
  databaseFile: path.isAbsolute(databaseFileRaw) ? databaseFileRaw : path.join(ROOT, databaseFileRaw),
  timezone: assertTimezone(str('APP_TIMEZONE', 'UTC')),
  slotMinutes: int('SLOT_MINUTES', 60, { min: 15, max: 240 }),
  bookingWindowDays: int('BOOKING_WINDOW_DAYS', 21, { min: 1, max: 120 }),
  bookingLeadHours: int('BOOKING_LEAD_HOURS', 2, { min: 0, max: 168 }),
  maxActiveRequests: int('MAX_ACTIVE_REQUESTS', 5, { min: 1, max: 50 }),
  sessionTtlHours: int('SESSION_TTL_HOURS', 168, { min: 1, max: 24 * 90 }),
  trustProxy: bool('TRUST_PROXY', false),
  publicDir: path.join(ROOT, 'src', 'public'),
  migrationsDir: path.join(ROOT, 'src', 'db', 'migrations'),
  seed: {
    adminEmail: str('SEED_ADMIN_EMAIL', 'admin@peerlearn.test'),
    adminPassword: str('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026'),
  },
  limits: {
    bodyBytes: 64 * 1024,
    messageLength: 2000,
    bioLength: 1500,
    noteLength: 500,
    reviewLength: 1000,
    pageSize: 9,
  },
};

export default config;
