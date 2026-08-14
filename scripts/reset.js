#!/usr/bin/env node
/**
 * Delete the database file so the next start rebuilds it from migrations.
 * Usage: npm run reset
 */
import { existsSync, rmSync } from 'node:fs';
import config from '../src/config.js';

const targets = [
  config.databaseFile,
  `${config.databaseFile}-wal`,
  `${config.databaseFile}-shm`,
  `${config.databaseFile}-journal`,
];

let removed = 0;
for (const target of targets) {
  if (existsSync(target)) {
    rmSync(target, { force: true });
    removed += 1;
  }
}

console.log(
  removed
    ? `Removed ${removed} database file(s). Run "npm run migrate" or "npm run seed" to rebuild.`
    : 'Nothing to remove - no database file found.'
);
