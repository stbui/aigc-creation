type RouteLoader = () => Promise<unknown>;

const loaders = new Map<string, RouteLoader>();
const started = new Set<string>();

/** Register a route chunk so navigation intent can warm it before the click lands. */
export function registerRoutePreload(path: string, loader: RouteLoader) {
  loaders.set(path, loader);
}

function candidatesFor(pathname: string) {
  const candidates = [pathname];
  if (pathname.startsWith('/tools/')) candidates.push('/tools/*');
  if (pathname.startsWith('/admin/')) candidates.push('/admin/*');
  if (pathname.startsWith('/legal/')) candidates.push('/legal/*');
  if (pathname.startsWith('/checkout/')) candidates.push('/checkout/*');
  return candidates;
}

/**
 * Warm the chunk for a route without navigating. Import failures are ignored:
 * a failed prefetch must never surface as a page error, the real navigation
 * still owns user-facing error handling.
 */
export function preloadRoute(pathname: string) {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return;
  const key = candidatesFor(pathname).find((candidate) => loaders.has(candidate));
  if (!key || started.has(key)) return;

  started.add(key);
  void Promise.resolve(loaders.get(key)?.()).catch(() => {
    // Allow a later hover/click to retry a transient chunk failure.
    started.delete(key);
  });
}
