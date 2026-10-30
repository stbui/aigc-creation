import { HUOJUE_BUILD_CONFIG } from "./build-config.js";

export const ENVIRONMENT_NAMES = Object.freeze({
  DEVELOPMENT: "development",
  PRODUCTION: "production"
});

/** 生产站点的占位域名：发布前必须替换，见下方 createEnvironment 的守卫。 */
const PRODUCTION_FRONTEND_ORIGIN = "https://your-domain.com";

const FRONTEND_ORIGINS = Object.freeze({
  [ENVIRONMENT_NAMES.DEVELOPMENT]: "http://localhost:5100",
  [ENVIRONMENT_NAMES.PRODUCTION]: PRODUCTION_FRONTEND_ORIGIN
});

/**
 * 同一站点在开发态的等价来源。
 *
 * `localhost` 与 `127.0.0.1` 在浏览器里是**两个来源**（CORS、localStorage
 * 都按来源隔离），用户随手换一种写法就会读不到令牌。两者都认，交互行为一致。
 */
const EQUIVALENT_ORIGINS = Object.freeze({
  "http://localhost:5100": Object.freeze(["http://127.0.0.1:5100"]),
  "http://127.0.0.1:5100": Object.freeze(["http://localhost:5100"])
});

/** 后端全局前缀；与 backend/src/main.ts 的 setGlobalPrefix 保持一致 */
const API_PREFIX = "/api/v1";

export const ACTIVE_ENVIRONMENT = HUOJUE_BUILD_CONFIG.environment;

/**
 * 解析当前档位的站点地址。
 *
 * 生产档仍指向占位域名时**直接抛错**：静默回落到 localhost 会让线上用户
 * 看到「采集失败」却查不出原因，而抛错至少能在扩展的 Service Worker
 * 控制台里一眼看到原因 —— 这正是发布前必须做的配置动作。
 */
export function createEnvironment(name) {
  const frontendOrigin = FRONTEND_ORIGINS[name];
  if (!frontendOrigin) {
    throw new Error(`未知的扩展运行环境：${name}`);
  }
  if (
    name === ENVIRONMENT_NAMES.PRODUCTION &&
    frontendOrigin === PRODUCTION_FRONTEND_ORIGIN
  ) {
    throw new Error(
      "生产域名未配置：请先填写 extension/background/environment.js 的 PRODUCTION_FRONTEND_ORIGIN。"
    );
  }

  return Object.freeze({
    name,
    frontendOrigin,
    apiBaseUrl: `${frontendOrigin}${API_PREFIX}`,
    pages: Object.freeze({
      login: `${frontendOrigin}/login`,
      library: `${frontendOrigin}/asset-library`,
      replicate: `${frontendOrigin}/viral-clone`,
      workbench: `${frontendOrigin}/workbench`
    })
  });
}

export const ENVIRONMENT = createEnvironment(ACTIVE_ENVIRONMENT);
export const FRONTEND_ORIGIN = ENVIRONMENT.frontendOrigin;
export const API_BASE_URL = ENVIRONMENT.apiBaseUrl;
export const LOGIN_URL = ENVIRONMENT.pages.login;
export const LIBRARY_URL = ENVIRONMENT.pages.library;
export const REPLICATE_URL = ENVIRONMENT.pages.replicate;
export const WORKBENCH_URL = ENVIRONMENT.pages.workbench;

/** chrome.tabs.query 的 URL 匹配模式（含等价来源） */
export const FRONTEND_TAB_URL_PATTERNS = Object.freeze(
  [FRONTEND_ORIGIN, ...(EQUIVALENT_ORIGINS[FRONTEND_ORIGIN] || [])].map(
    (origin) => `${origin}/*`
  )
);

/**
 * 该主机名是否就是本站（或本地开发地址）。
 *
 * 本站自己的页面上不该出现「采集到本站」的悬停按钮与右键菜单 ——
 * 那等于把站内素材再存一遍，且登录态读的是同一个 localStorage，纯属自扰。
 */
export function isSiteHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return false;
  }

  const siteHosts = new Set(
    [FRONTEND_ORIGIN, ...(EQUIVALENT_ORIGINS[FRONTEND_ORIGIN] || [])].map(
      (origin) => new URL(origin).hostname
    )
  );
  siteHosts.add("localhost");
  siteHosts.add("127.0.0.1");
  return siteHosts.has(host);
}

/** 该 URL 是否属于本项目站点（含 localhost / 127.0.0.1 等价来源） */
export function isFrontendPageUrl(value) {
  let origin;
  try {
    origin = new URL(value).origin;
  } catch {
    return false;
  }
  return (
    origin === FRONTEND_ORIGIN ||
    (EQUIVALENT_ORIGINS[FRONTEND_ORIGIN] || []).includes(origin)
  );
}

/** 相对地址补成站点绝对地址（本地存储返回 /uploads/... 这类相对路径） */
export function toAbsoluteUrl(value) {
  if (typeof value !== "string" || !value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  return `${FRONTEND_ORIGIN}${value.startsWith("/") ? "" : "/"}${value}`;
}
