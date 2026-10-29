/* DSH Mobile — hash router.
 * Static hosting friendly: every screen is #/path, no server rewrites needed.
 * Routes: /pair, /sessions, /s/{id}, /settings, /lab.
 */

const ROUTES = [
  { re: /^\/$/, name: 'sessions' },
  { re: /^\/sessions$/, name: 'sessions' },
  { re: /^\/pair$/, name: 'pair' },
  { re: /^\/settings$/, name: 'settings' },
  { re: /^\/lab$/, name: 'lab' },
  { re: /^\/s\/([^/]+)$/, name: 'session', params: ['id'] },
];

export function parseHash(hash = location.hash) {
  let raw = String(hash || '').replace(/^#/, '');
  if (!raw) raw = '/sessions';
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const question = raw.indexOf('?');
  const pathPart = question === -1 ? raw : raw.slice(0, question);
  const query = new URLSearchParams(question === -1 ? '' : raw.slice(question + 1));
  const path = pathPart.replace(/\/+$/, '') || '/';

  for (const route of ROUTES) {
    const match = path.match(route.re);
    if (!match) continue;
    const params = {};
    (route.params || []).forEach((name, index) => {
      try {
        params[name] = decodeURIComponent(match[index + 1]);
      } catch {
        params[name] = match[index + 1];
      }
    });
    return { name: route.name, path, params, query, hash: `#${raw}` };
  }
  return { name: 'notFound', path, params: {}, query, hash: `#${raw}` };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${String(path || '/sessions').replace(/^#/, '')}`;
  if (location.hash === target) return false;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
  return true;
}

export function replaceRoute(path) {
  const target = `#${String(path || '/sessions').replace(/^#/, '')}`;
  if (location.hash !== target) history.replaceState(null, '', target);
}

export function pathFor(name, params = {}) {
  switch (name) {
    case 'sessions':
      return '/sessions';
    case 'pair':
      return '/pair';
    case 'settings':
      return '/settings';
    case 'lab':
      return '/lab';
    case 'session':
      return `/s/${encodeURIComponent(params.id || '')}`;
    default:
      return '/sessions';
  }
}

export function startRouter(onRoute) {
  let lastHash = location.hash;
  const handle = () => {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    onRoute(parseHash());
  };
  window.addEventListener('hashchange', handle);
  onRoute(parseHash());
  return () => window.removeEventListener('hashchange', handle);
}

export function currentRoute() {
  return parseHash();
}
