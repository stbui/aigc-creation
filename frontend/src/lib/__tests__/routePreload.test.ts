import { describe, expect, it, vi } from 'vitest';
import { preloadRoute, registerRoutePreload } from '../routePreload';

describe('routePreload', () => {
  it('warms an exact route only once', async () => {
    const loader = vi.fn(async () => ({ ok: true }));
    registerRoutePreload('/preload-exact', loader);

    preloadRoute('/preload-exact');
    preloadRoute('/preload-exact');

    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });

  it('matches wildcard routes such as tools and admin', async () => {
    const loader = vi.fn(async () => ({ ok: true }));
    registerRoutePreload('/tools/*', loader);

    preloadRoute('/tools/product-kit');

    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });

  it('ignores external and protocol-relative paths', () => {
    const loader = vi.fn(async () => ({ ok: true }));
    registerRoutePreload('//evil.example/path', loader);

    preloadRoute('//evil.example/path');
    preloadRoute('https://evil.example/path');

    expect(loader).not.toHaveBeenCalled();
  });

  it('allows a later retry after a failed prefetch', async () => {
    const loader = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ ok: true });
    registerRoutePreload('/preload-retry', loader);

    preloadRoute('/preload-retry');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    preloadRoute('/preload-retry');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
});
