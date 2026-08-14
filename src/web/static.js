/**
 * Static asset serving for `src/public`.
 *
 * Path traversal is blocked by resolving the request against the public
 * directory and refusing anything that escapes it.
 */
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * @returns {boolean} true when the request was handled as a static asset
 */
export function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;

  const extension = path.extname(decoded).toLowerCase();
  if (!MIME_TYPES[extension]) return false;

  const target = path.resolve(config.publicDir, `.${path.posix.normalize(decoded)}`);
  const root = path.resolve(config.publicDir);
  if (target !== root && !target.startsWith(root + path.sep)) return false;

  let stats;
  try {
    stats = statSync(target);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;

  const etag = `W/"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension],
    'Content-Length': stats.size,
    'Cache-Control': config.isProduction ? 'public, max-age=86400' : 'no-cache',
    ETag: etag,
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  createReadStream(target).pipe(res);
  return true;
}
