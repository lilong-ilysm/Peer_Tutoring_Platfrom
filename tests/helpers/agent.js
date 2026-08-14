/**
 * HTTP test agent: starts the real request handler on an ephemeral port and
 * keeps a cookie jar, so integration tests hit the app exactly as a browser
 * would (including session cookies and CSRF tokens).
 */
import http from 'node:http';
import { createRequestHandler } from '../../src/web/app.js';

export async function startServer() {
  const server = http.createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    port,
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function createAgent(origin) {
  const jar = new Map();

  function cookieHeader() {
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function absorb(response) {
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
  }

  async function request(method, path, { body, headers = {}, json } = {}) {
    const init = {
      method,
      redirect: 'manual',
      headers: { Cookie: cookieHeader(), ...headers },
    };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['Content-Type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = typeof body === 'string' ? body : new URLSearchParams(body).toString();
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(origin + path, init);
    absorb(response);
    const text = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location'),
      headers: response.headers,
      text,
      json() {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
    };
  }

  return {
    jar,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),

    /** Read the CSRF token out of a rendered page. */
    async csrf(path = '/login') {
      const response = await request('GET', path);
      const match = /name="_csrf" value="([^"]+)"/.exec(response.text);
      return { token: match ? match[1] : null, response };
    },

    /** Log in through the real form, returning the redirect response. */
    async login(email, password) {
      const { token } = await this.csrf('/login');
      return request('POST', '/login', { body: { email, password, _csrf: token } });
    },
  };
}
