import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { membershipApi, myMarketingApi, notificationsApi } from '../lib/api';
import { preloadRoute } from '../lib/routePreload';
import { useAuth } from '../context/AuthContext';
import { useBodyScrollLock, useCampaignCountdown } from '../hooks';
import type { MyMembership, NotificationItem, PopupCampaign } from '../types/api';

/* ───────── 本地存储与常量 ───────── */

const GUEST_PROMO_DISMISS_KEY = 'huojue-guest-promo-dismissed-v1';
const GUEST_PROMO_SHOWN_KEY = 'huojue-guest-promo-shown-v1';
const GUEST_PROMO_DELAY_MS = 6000;
const GUEST_PROMO_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const ROUTE_SCROLL_KEY = 'huojue-route-scroll-v1';
const ROUTE_ENTER_CLASS = 'is-route-entering';
const ROUTE_ENTER_MS = 240;

/** 读取 localStorage 布尔标记；隐私模式等写入/读取失败一律按「未标记」处理。 */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式等场景下写入失败, 不影响本次会话 */
  }
}

/* ───────── 外壳 ───────── */

/** 顶栏滚动阴影：滚动超过 4px 置为 elevated，rAF 节流避免每次滚动都 setState。 */
export function useHeaderElevated(): boolean {
  const [elevated, setElevated] = useState(false);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setElevated(window.scrollY > 4);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return elevated;
}

/** 移动导航抽屉：顶栏唤起、侧栏关闭，路由变化自动收起。 */
export function useMobileNav() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const openMobileNav = useCallback(() => setMobileOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileOpen(false), []);

  return { mobileOpen, openMobileNav, closeMobileNav };
}

/* ───────── 顶导消息铃铛 ───────── */

/**
 * 站内消息收件箱。
 *
 * 未登录不拉取；登录后立即取一次，之后 60s 静默轮询维持角标。页面隐藏时停表，
 * 回到前台先补一次再继续；账户页等入口标记已读后广播 `notifications:changed`
 * 也会触发刷新。所有请求失败都静默保留上一次数据，不打断主界面。
 */
export function useNotificationInbox() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!token) return;
      if (showSpinner) setLoading(true);
      try {
        const res = await notificationsApi.list({ limit: 20 });
        setItems(res.items);
        setUnread(res.unread);
      } catch {
        // 静默失败：保留上一次角标与列表，不打断主界面
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      setItems([]);
      setUnread(0);
      return;
    }
    void load(false);
    let timer = 0;
    const startPolling = () => {
      if (timer) return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load(false);
      }, 60_000);
    };
    const stopPolling = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(false);
        startPolling();
      } else {
        stopPolling();
      }
    };
    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    const onChanged = () => void load(false);
    window.addEventListener('notifications:changed', onChanged);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('notifications:changed', onChanged);
    };
  }, [token, load]);

  const markAllRead = useCallback(async () => {
    try {
      await notificationsApi.readAll();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      setUnread(0);
    } catch {
      /* 忽略：下次轮询会纠正 */
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    try {
      const res = await notificationsApi.read(id);
      setUnread(res.unread);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, readAt: new Date().toISOString() } : it)),
      );
    } catch {
      /* 已读失败仍然允许跳转，用户要看的是内容 */
    }
  }, []);

  return { token, items, unread, loading, reload: load, markAllRead, markRead };
}

/* ───────── 游客首访营销弹层 ───────── */

/**
 * 游客首访营销弹层状态。
 *
 * 停留 6 秒且期间无操作时弹出；登录、登录弹窗打开、当天已关闭或本会话已展示过
 * 都不再弹。活动数据取自 `/marketing/popup`，接口失败时展示静态真实权益。
 */
export function useGuestPromoOffer() {
  const { token, loginOpen } = useAuth();
  const [dismissed, setDismissed] = useState(() => readFlag(GUEST_PROMO_DISMISS_KEY));
  const [autoOpen, setAutoOpen] = useState(false);
  const [campaign, setCampaign] = useState<PopupCampaign | null>(null);

  useEffect(() => {
    if (dismissed || token || loginOpen) return;
    try {
      // The offer is optional chrome. Do not reopen it on every SPA route change
      // after the user has already seen it once in this browser session.
      if (sessionStorage.getItem(GUEST_PROMO_SHOWN_KEY) === '1') return;
    } catch {
      // Storage failures just disable the duplicate-show guard.
    }

    let timer = 0;
    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      for (const event of GUEST_PROMO_EVENTS) {
        window.removeEventListener(event, onInteract);
      }
    };
    const onInteract = () => cleanup();

    for (const event of GUEST_PROMO_EVENTS) {
      window.addEventListener(event, onInteract, { passive: true, once: true });
    }
    timer = window.setTimeout(() => {
      setAutoOpen(true);
      try {
        sessionStorage.setItem(GUEST_PROMO_SHOWN_KEY, '1');
      } catch {
        /* ignore */
      }
      cleanup();
    }, GUEST_PROMO_DELAY_MS);
    return cleanup;
  }, [dismissed, loginOpen, token]);

  useEffect(() => {
    if (dismissed || token) return;
    let alive = true;
    myMarketingApi
      .popup()
      .then((value) => {
        if (alive) setCampaign(value ?? null);
      })
      .catch(() => {
        // 营销位不可用不应阻塞页面；静态权益仍可展示。
        if (alive) setCampaign(null);
      });
    return () => {
      alive = false;
    };
  }, [dismissed, token]);

  const { parts, expired } = useCampaignCountdown(campaign);
  const open = !token && !dismissed && autoOpen && !loginOpen && !expired;
  useBodyScrollLock(open);

  const dismiss = useCallback(() => {
    setDismissed(true);
    writeFlag(GUEST_PROMO_DISMISS_KEY, '1');
  }, []);

  return { open, campaign, parts, dismiss };
}

/* ───────── 账户菜单 ───────── */

/**
 * 当前账号的会员信息。
 *
 * 下拉面板每次打开都刷新；`authEpoch` 变化（登录态切换）时重新拉取，
 * 并用请求序号丢弃过期响应，避免旧账号的数据覆盖新账号。
 */
export function useAccountMembership() {
  const { authEpoch } = useAuth();
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const next = await membershipApi.me();
      if (requestSeq.current === seq) setMembership(next);
    } catch {
      if (requestSeq.current === seq) {
        setMembership(null);
        setFailed(true);
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      requestSeq.current += 1;
    };
  }, [authEpoch, reload]);

  return { membership, loading, failed, reload };
}

/* ───────── 路由体验 ───────── */

type ScrollMemory = Record<string, number>;

function readScrollMemory(): ScrollMemory {
  try {
    const raw = sessionStorage.getItem(ROUTE_SCROLL_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? (value as ScrollMemory) : {};
  } catch {
    return {};
  }
}

function writeScrollMemory(memory: ScrollMemory) {
  try {
    sessionStorage.setItem(ROUTE_SCROLL_KEY, JSON.stringify(memory));
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
 * 路由体验：前进/后退保留滚动位置，新路由回到顶部，悬停预取路由 chunk。
 */
export function useRouteExperience() {
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

    const target = navigationType === 'POP' ? (memoryRef.current![location.key] ?? 0) : 0;
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
}
