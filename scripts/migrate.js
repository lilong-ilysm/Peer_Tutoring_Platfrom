#!/usr/bin/env node
/**
 * Apply pending database migrations. Safe to run repeatedly.
 * Usage: npm run migrate
 */
import config from '../src/config.js';
import { Database, migrate } from '../src/db/index.js';

const database = new Database(config.databaseFile);
try {
  const applied = migrate(database);
  const tables = database
    .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name);
  console.log(`Database: ${config.databaseFile}`);
  console.log(`Migrations applied this run: ${applied}`);
  console.log(`Tables (${tables.length}): ${tables.join(', ')}`);
} finally {
  database.close();
}
