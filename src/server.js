#!/usr/bin/env node
/**
 * Application entry point.
 *
 * Opens (and migrates) the database before listening, so the process fails
 * fast on a bad schema instead of serving broken pages.
 */
import config from './config.js';
import { closeDb, getDb } from './db/index.js';
import logger from './lib/logger.js';
import { purgeExpiredSessions } from './services/auth.js';
import { createServer } from './web/app.js';

getDb();
const purged = purgeExpiredSessions();
if (purged) logger.info('expired sessions purged', { count: purged });

const server = createServer();

server.listen(config.port, config.host, () => {
  const address = server.address();
  logger.info('server listening', {
    url: `http://${config.host}:${address.port}`,
    env: config.env,
    timezone: config.timezone,
    database: config.databaseFile,
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error('port already in use', { port: config.port });
    process.exit(1);
  }
  logger.fault(error);
  process.exit(1);
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Do not hang forever on lingering keep-alive sockets.
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.fault(error, { fatal: 'uncaughtException' });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fault(reason instanceof Error ? reason : new Error(String(reason)), {
    fatal: 'unhandledRejection',
  });
});
