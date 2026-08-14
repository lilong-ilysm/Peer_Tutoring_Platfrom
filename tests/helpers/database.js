/**
 * Per-test-file database isolation: each file gets its own migrated SQLite
 * file in the OS temp directory and installs it as the shared handle.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, createDatabase, setDb } from '../../src/db/index.js';
import { clearAllLimiters } from '../../src/lib/ratelimit.js';

export function useTempDatabase() {
  const file = path.join(os.tmpdir(), `peerlearn-test-${randomUUID()}.db`);
  const database = createDatabase(file);
  setDb(database);
  clearAllLimiters();

  return {
    database,
    file,
    cleanup() {
      closeDb();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try {
          rmSync(`${file}${suffix}`, { force: true });
        } catch {
          /* best effort - the OS temp dir is disposable */
        }
      }
    },
  };
}
