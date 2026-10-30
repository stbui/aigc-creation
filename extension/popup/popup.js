import { isSiteHostname } from "../background/environment.js";

const GET_USER_INFO_MESSAGE = "huojue:get-user-info";
const GET_PROJECTS_MESSAGE = "huojue:get-projects";
const OPEN_LOGIN_MESSAGE = "huojue:open-login";
const OPEN_PAGE_MESSAGE = "huojue:open-page";
/** 点「查看我的素材」时等待分组预取的上限，超时就跳不带分组的素材库 */
const PROJECT_PREFETCH_WAIT_MS = 1500;
const DISABLED_HOSTS_STORAGE_KEY = "huojueDisabledHosts";

let currentTabId = null;
let currentHost = null;
let loggedOutAnimation = null;
let loggedOutAnimationMediaQuery = null;
let projectPrefetch = null;
let projectPrefetchSettled = false;
let selectedProject = null;
let libraryOpening = false;

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  localizeStaticUi();
  initializeLoggedOutAnimation();
  $("#login-button").addEventListener("click", openLogin);
  $("#library-button").addEventListener("click", openLibrary);
  $("#current-site-toggle").addEventListener("change", saveCurrentSiteSetting);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  currentHost = getHostFromUrl(tab?.url);

  const [user] = await Promise.all([loadUserInfo(), loadCurrentSiteSetting()]);

  if (user) {
    renderUser(user);
    void prefetchSelectedProject();
  } else {
    renderLoggedOut();
  }
}

/**
 * 打开素材库。
 *
 * 带上当前分组：用户点「查看我的素材」想看的是刚采集的那批图，
 * 直接跳到全库会让他们再手动分组一次。
 */
async function openLibrary() {
  if (libraryOpening) return;

  libraryOpening = true;
  const button = $("#library-button");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = `${t("viewLibrary")}…`;

  try {
    const project = await getProjectForClick();
    await chrome.runtime.sendMessage({
      type: OPEN_PAGE_MESSAGE,
      page: "library",
      tabId: currentTabId,
      projectId: project?.projectId
    });
  } finally {
    libraryOpening = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = t("viewLibrary");
  }
}

function prefetchSelectedProject() {
  if (projectPrefetch) return projectPrefetch;

  projectPrefetch = chrome.runtime
    .sendMessage({
      type: GET_PROJECTS_MESSAGE,
      tabId: currentTabId,
      // 弹窗只是看一眼，未登录时不该凭空弹出登录页
      openLoginOnRequired: false
    })
    .then((response) => {
      selectedProject =
        response?.ok && response.selectedProject?.projectId
          ? response.selectedProject
          : null;
      return selectedProject;
    })
    .catch(() => null)
    .finally(() => {
      projectPrefetchSettled = true;
    });
  return projectPrefetch;
}

async function getProjectForClick() {
  const prefetch = prefetchSelectedProject();
  if (projectPrefetchSettled) return selectedProject;

  return Promise.race([
    prefetch,
    new Promise((resolve) => {
      window.setTimeout(() => resolve(null), PROJECT_PREFETCH_WAIT_MS);
    })
  ]);
}

async function loadUserInfo() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: GET_USER_INFO_MESSAGE,
      tabId: currentTabId
    });

    if (!response?.ok || !response.user) {
      throw new Error(response?.error || t("notLoggedIn"));
    }

    return response.user;
  } catch {
    return null;
  }
}

function renderUser(user) {
  // 后端 `/me` 不下发头像，统一用首字母占位：邮箱首字母比空头像更可辨认
  const name = user.name || user.email || t("defaultUser");
  $("#user-name").textContent = name;
  $("#user-avatar-fallback").textContent =
    Array.from(name)[0]?.toUpperCase() || "货";
  setPopupState("logged-in");
}

function renderLoggedOut() {
  setPopupState("logged-out");
}

function setPopupState(state) {
  const popup = $(".popup");
  $("#loading-view").hidden = state !== "loading";
  $("#logged-out-view").hidden = state !== "logged-out";
  $("#logged-in-view").hidden = state !== "logged-in";
  popup.classList.remove(
    "popup--loading",
    "popup--logged-out",
    "popup--logged-in"
  );
  popup.classList.add(`popup--${state}`);
  popup.setAttribute("aria-busy", String(state === "loading"));
  syncLoggedOutAnimationPlayback();
}

function initializeLoggedOutAnimation() {
  const root = $("#logged-out-animation");
  const player = $("#logged-out-animation-player");

  if (!root || !player || !window.lottie) return;

  loggedOutAnimationMediaQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  try {
    loggedOutAnimation = window.lottie.loadAnimation({
      container: player,
      renderer: "svg",
      loop: true,
      autoplay: false,
      path: chrome.runtime.getURL("popup/animation/animation.json"),
      rendererSettings: {
        preserveAspectRatio: "xMidYMid meet",
        progressiveLoad: true
      }
    });

    loggedOutAnimation.addEventListener("DOMLoaded", () => {
      root.classList.add("logged-out-animation--ready");
      syncLoggedOutAnimationPlayback();
    });
    loggedOutAnimation.addEventListener("data_failed", () => {
      root.classList.remove("logged-out-animation--ready");
    });

    loggedOutAnimationMediaQuery.addEventListener(
      "change",
      syncLoggedOutAnimationPlayback
    );
    document.addEventListener(
      "visibilitychange",
      syncLoggedOutAnimationPlayback
    );
  } catch {
    loggedOutAnimation = null;
  }
}

function syncLoggedOutAnimationPlayback() {
  if (!loggedOutAnimation) return;

  const shouldPlay =
    !$("#logged-out-view").hidden &&
    document.visibilityState === "visible" &&
    !loggedOutAnimationMediaQuery?.matches;

  if (shouldPlay) {
    loggedOutAnimation.play();
  } else {
    loggedOutAnimation.pause();
  }
}

async function openLogin() {
  const button = $("#login-button");
  button.disabled = true;
  setMessage(t("openingLogin"));

  try {
    const response = await chrome.runtime.sendMessage({
      type: OPEN_LOGIN_MESSAGE,
      tabId: currentTabId
    });

    if (!response?.ok) {
      throw new Error(response?.error || t("cannotOpenLogin"));
    }
  } catch (error) {
    setMessage(error.message || t("cannotOpenLoginRetry"), "error");
  } finally {
    button.disabled = false;
  }
}

async function loadCurrentSiteSetting() {
  const toggle = $("#current-site-toggle");
  const settingBlock = $(".site-setting-block");

  if (currentHost && isSiteHostname(currentHost)) {
    settingBlock.hidden = true;
    toggle.checked = false;
    toggle.disabled = true;
    return;
  }

  settingBlock.hidden = false;

  // chrome:// 等非 HTTP 页面没有可禁用的站点
  if (!currentHost) {
    toggle.checked = false;
    toggle.disabled = true;
    return;
  }

  try {
    const stored = await chrome.storage.local.get(DISABLED_HOSTS_STORAGE_KEY);
    const disabledHosts = normalizeDisabledHosts(
      stored[DISABLED_HOSTS_STORAGE_KEY]
    );

    toggle.checked = disabledHosts[currentHost] === true;
    toggle.disabled = false;
  } catch {
    toggle.checked = false;
    toggle.disabled = true;
  }
}

async function saveCurrentSiteSetting() {
  if (!currentHost || isSiteHostname(currentHost)) return;

  try {
    const stored = await chrome.storage.local.get(DISABLED_HOSTS_STORAGE_KEY);
    const disabledHosts = normalizeDisabledHosts(
      stored[DISABLED_HOSTS_STORAGE_KEY]
    );
    if ($("#current-site-toggle").checked) {
      disabledHosts[currentHost] = true;
    } else {
      delete disabledHosts[currentHost];
    }
    await chrome.storage.local.set({
      [DISABLED_HOSTS_STORAGE_KEY]: disabledHosts
    });
  } catch (error) {
    setMessage(error.message || t("settingsSaveFailed"), "error");
  }
}

function normalizeDisabledHosts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([host, disabled]) => typeof host === "string" && disabled === true
    )
  );
}

function getHostFromUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function setMessage(text, type = "") {
  const message = $("#message");
  message.textContent = text;
  message.className = type ? `message message--${type}` : "message";
}

function localizeStaticUi() {
  document.documentElement.lang = chrome.i18n.getUILanguage().replace("_", "-");
  document.title = t("extensionName");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n) || element.textContent;
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute(
      "aria-label",
      t(element.dataset.i18nAriaLabel) || element.getAttribute("aria-label")
    );
  });
}

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || "";
}
