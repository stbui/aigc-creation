/**
 * 站点登录态监听。
 *
 * 只注入到本站页面（见 manifest 的第二个 content_scripts 条目），
 * 职责是把 `localStorage` 里的令牌变化同步给 Service Worker：
 * 采集页是第三方电商站，读不到本站 localStorage，只能由这里转发。
 */
(() => {
  const AUTH_STATE_MESSAGE = "huojue:auth-state";
  /** 必须与前端 `frontend/src/lib/auth.ts` 的 TOKEN_KEY 逐字一致 */
  const USER_TOKEN_STORAGE_KEY = "ecom_vision_token";
  const POLL_INTERVAL_MS = 1000;

  let lastToken;
  let pollTimer = null;

  function readToken() {
    try {
      const value = localStorage.getItem(USER_TOKEN_STORAGE_KEY);
      return typeof value === "string" && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  }

  async function publishAuthState(force = false) {
    const token = readToken();
    if (!force && token === lastToken) {
      return;
    }

    lastToken = token;
    try {
      await chrome.runtime.sendMessage({
        type: AUTH_STATE_MESSAGE,
        authenticated: Boolean(token),
        token
      });
    } catch {
      // 扩展重载或页面卸载时消息通道可能暂不可用，下一轮继续检测
      lastToken = undefined;
    }
  }

  function startPolling() {
    if (pollTimer !== null) {
      return;
    }
    pollTimer = window.setInterval(() => {
      void publishAuthState();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer === null) {
      return;
    }
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  window.addEventListener("storage", (event) => {
    // 同标签页写入不会触发 storage 事件，故仍保留轮询作为兜底
    if (event.key === USER_TOKEN_STORAGE_KEY || event.key === null) {
      void publishAuthState();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void publishAuthState(true);
    }
  });

  window.addEventListener("pagehide", stopPolling);

  window.addEventListener("pageshow", () => {
    void publishAuthState(true);
    startPolling();
  });

  void publishAuthState(true);
  startPolling();
})();
