/**
 * Tiny path router.
 *
 * A route is a method, a path pattern (`/bookings/:id`) and a chain of async
 * functions. Every function receives the request context; guards throw
 * (HttpError / RedirectError) to stop the chain, the last function renders.
 */

function compile(pattern) {
  if (pattern === '*') return { regex: /^.*$/, keys: [] };
  const keys = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment === '*') {
        keys.push('wildcard');
        return '(.*)';
      }
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source || '/'}/?$`), keys };
}

export class Router {
  constructor() {
    /** @type {{method:string, pattern:string, regex:RegExp, keys:string[], chain:Function[]}[]} */
    this.routes = [];
  }

  add(method, pattern, ...chain) {
    if (chain.length === 0) throw new Error(`Route ${method} ${pattern} has no handler`);
    const { regex, keys } = compile(pattern);
    this.routes.push({ method: method.toUpperCase(), pattern, regex, keys, chain });
    return this;
  }

  get(pattern, ...chain) {
    return this.add('GET', pattern, ...chain);
  }

  post(pattern, ...chain) {
    return this.add('POST', pattern, ...chain);
  }

  put(pattern, ...chain) {
    return this.add('PUT', pattern, ...chain);
  }

  patch(pattern, ...chain) {
    return this.add('PATCH', pattern, ...chain);
  }

  delete(pattern, ...chain) {
    return this.add('DELETE', pattern, ...chain);
  }

  /**
   * @returns {{route:object, params:Record<string,string>}|{allowed:string[]}|null}
   *  a match, the set of methods allowed for a matching path (405), or null.
   */
  match(method, pathname) {
    const upper = method.toUpperCase();
    const allowed = new Set();
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      if (route.method !== upper && !(upper === 'HEAD' && route.method === 'GET')) {
        allowed.add(route.method);
        continue;
      }
      const params = {};
      route.keys.forEach((key, index) => {
        const value = found[index + 1];
        if (value === undefined) return;
        try {
          params[key] = decodeURIComponent(value);
        } catch {
          params[key] = value;
        }
      });
      return { route, params };
    }
    if (allowed.size) return { allowed: [...allowed] };
    return null;
  }
}

export default Router;
