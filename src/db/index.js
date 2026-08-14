/**
 * Database access layer (SQLite via the built-in `node:sqlite` module).
 *
 * Every query in the application goes through this wrapper, which:
 *  - only ever uses bound parameters (no string interpolation, so no SQL
 *    injection surface),
 *  - normalises JS values SQLite cannot bind (booleans, undefined),
 *  - caches prepared statements,
 *  - provides real transactions with savepoint-based nesting.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import logger from '../lib/logger.js';

/** SQLite binds null/number/bigint/string/Buffer only. */
function normaliseParams(params) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (value === true) return 1;
    if (value === false) return 0;
    if (value instanceof Date) return value.toISOString();
    return value;
  });
}

export class Database {
  /** @param {string} file path to the database file, or ':memory:' */
  constructor(file) {
    if (file !== ':memory:') {
      const dir = path.dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.statements = new Map();
    this.savepointDepth = 0;

    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA synchronous = NORMAL;');
  }

  prepare(sql) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /** @returns {object[]} */
  all(sql, params = []) {
    return this.prepare(sql).all(...normaliseParams(params));
  }

  /** @returns {object|undefined} */
  get(sql, params = []) {
    return this.prepare(sql).get(...normaliseParams(params));
  }

  /** @returns {{changes:number, lastInsertRowid:number}} */
  run(sql, params = []) {
    const result = this.prepare(sql).run(...normaliseParams(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /** Single scalar value from the first column of the first row. */
  value(sql, params = []) {
    const row = this.get(sql, params);
    if (!row) return undefined;
    const keys = Object.keys(row);
    return keys.length ? row[keys[0]] : undefined;
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  /**
   * Run `fn` inside a write transaction. Nested calls use savepoints so a
   * service can call another service without either knowing about the other.
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  transaction(fn) {
    if (this.savepointDepth > 0) {
      const name = `sp_${this.savepointDepth}`;
      this.savepointDepth += 1;
      this.raw.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        this.raw.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        this.raw.exec(`ROLLBACK TO ${name}`);
        this.raw.exec(`RELEASE ${name}`);
        throw error;
      } finally {
        this.savepointDepth -= 1;
      }
    }

    this.savepointDepth = 1;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* the transaction was already unwound */
      }
      throw error;
    } finally {
      this.savepointDepth = 0;
    }
  }

  close() {
    this.statements.clear();
    try {
      this.raw.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Apply every pending migration inside a transaction. A failure aborts before
 * the version is recorded, so the app never runs on a half-migrated schema.
 */
export function migrate(database, migrationsDir = config.migrationsDir) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database.all('SELECT version FROM schema_migrations').map((row) => row.version)
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    database.transaction(() => {
      database.exec(sql);
      database.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        file,
        new Date().toISOString(),
      ]);
    });
    logger.info('migration applied', { version: file });
    count += 1;
  }
  return count;
}

/** @type {Database|null} */
let instance = null;

/** Process-wide database handle (opened and migrated on first use). */
export function getDb() {
  if (!instance) {
    instance = new Database(config.databaseFile);
    migrate(instance);
  }
  return instance;
}

/** Replace the shared handle - used by the test harness. */
export function setDb(database) {
  instance = database;
  return instance;
}

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/** Create an isolated, migrated database (tests, scripts). */
export function createDatabase(file) {
  const database = new Database(file);
  migrate(database);
  return database;
}
