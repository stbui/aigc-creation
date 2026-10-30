import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { preloadRoute } from '../lib/routePreload';

const SCROLL_MEMORY_KEY = 'ecom-route-scroll-v1';
const ROUTE_ENTER_CLASS = 'is-route-entering';
const ROUTE_ENTER_MS = 240;

type ScrollMemory = Record<string, number>;

function readScrollMemory(): ScrollMemory {
  try {
    const raw = sessionStorage.getItem(SCROLL_MEMORY_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? (value as ScrollMemory) : {};
  } catch {
    return {};
  }
}

function writeScrollMemory(memory: ScrollMemory) {
  try {
    sessionStorage.setItem(SCROLL_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // A blocked storage API only disables back/forward scroll memory.
  }
}

function restoreScroll(target: number) {
  let frame = 0;
  let attempts = 0;
  let cancelled = false;

  const apply = () => {
    if (cancelled) return;
    window.scrollTo({ top: target, left: 0, behavior: 'auto' });
    attempts += 1;
    // Lazy route content can mount after the first frame. Retry briefly until
    // the document is tall enough, then stop so the user keeps full control.
    if (target > 0 && Math.abs(window.scrollY - target) > 2 && attempts < 30) {
      frame = requestAnimationFrame(apply);
    }
  };

  apply();
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

/**
 * SPA navigation polish: preserve window scroll on back/forward, reset it on
 * new destinations, warm route chunks on intent, and replay a short enter
 * transition. All work is driven by passive listeners and transform/opacity.
 */
export function RouteExperience() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const memoryRef = useRef<ScrollMemory | null>(null);
  const previousPathRef = useRef(location.pathname);
  const currentKeyRef = useRef(location.key);

  // Render happens before effects. Updating the current key here prevents the
  // departing page's scroll listener from recording the destination's 0 scroll.
  currentKeyRef.current = location.key;

  if (memoryRef.current === null) memoryRef.current = readScrollMemory();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const key = location.key;
    const path = location.pathname;
    const memory = memoryRef.current!;
    let frame = 0;

    const onScroll = () => {
      // history.pushState updates the URL synchronously but React may render a
      // moment later. Check the live URL too, otherwise the destination's
      // scroll-to-top event gets attributed to the page the user just left.
      if (currentKeyRef.current !== key || window.location.pathname !== path) return;
      memory[key] = window.scrollY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        writeScrollMemory(memory);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      // Persist the latest value captured by onScroll. Reading window.scrollY
      // here would race the destination page's own scroll reset and overwrite
      // the departed page's position with 0.
      writeScrollMemory(memory);
    };
  }, [location.key]);

  useEffect(() => {
    const pathChanged = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (!pathChanged && navigationType !== 'POP') return;

    const target =
      navigationType === 'POP' ? (memoryRef.current![location.key] ?? 0) : 0;
    return restoreScroll(target);
  }, [location.key, location.pathname, navigationType]);

  useEffect(() => {
    const stage = document.querySelector<HTMLElement>('[data-route-stage]');
    if (!stage) return;

    stage.classList.remove(ROUTE_ENTER_CLASS);
    // Force a style flush so repeat visits to the same stage replay the motion.
    void stage.offsetWidth;
    stage.classList.add(ROUTE_ENTER_CLASS);

    const timer = window.setTimeout(() => {
      stage.classList.remove(ROUTE_ENTER_CLASS);
    }, ROUTE_ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => {
    const onIntent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin === window.location.origin) preloadRoute(url.pathname);
      } catch {
        // Malformed hrefs are left to the router/link fallback.
      }
    };

    document.addEventListener('pointerover', onIntent, { passive: true });
    document.addEventListener('touchstart', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);
    return () => {
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('touchstart', onIntent);
      document.removeEventListener('focusin', onIntent);
    };
  }, []);

  return null;
}
