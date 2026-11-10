const ACTION_CLASS = "huojue-image-action";
const ACTION_VISIBLE_CLASS = "huojue-image-action--visible";
const ACTION_EXPANDED_CLASS = "huojue-image-action--expanded";
const ACTION_PRIMARY_CLASS = "huojue-image-action__primary";
const ACTION_TOGGLE_CLASS = "huojue-image-action__toggle";
const ACTION_MENU_CLASS = "huojue-image-action__menu";
const ACTION_MENU_ITEM_CLASS = "huojue-image-action__menu-item";
const OPEN_MODAL_SELECTOR =
  'dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"]';
const MODAL_CANDIDATE_SELECTOR =
  'dialog, [role="dialog"], [aria-modal], #noteContainer';
const ACTION_SAVE_CONTROL_CLASS = "huojue-image-action__save-control";
const TOAST_CLASS = "huojue-toast";
const TOAST_VISIBLE_CLASS = "huojue-toast--visible";
const TOAST_URL_CLASS = "huojue-toast__url";
const TOAST_STATUS_CLASS = "huojue-toast__status";
const TOAST_HEADER_CLASS = "huojue-toast__header";
const TOAST_ACCOUNT_CLASS = "huojue-toast__account";
const TOAST_GROUP_TRIGGER_CLASS = "huojue-toast__group-trigger";
const TOAST_VIEW_CLASS = "huojue-toast__view";
const TOAST_GROUP_PANEL_CLASS = "huojue-toast__group-panel";
const TOAST_GROUP_LIST_CLASS = "huojue-toast__group-list";
const TOAST_GROUP_CREATE_CLASS = "huojue-toast__group-create";
const TOAST_ACTIONS_CLASS = "huojue-toast__actions";
const TOAST_COPY_CLASS = "huojue-toast__copy";
const TOAST_UPLOAD_CLASS = "huojue-toast__upload";
const DEBUG_LOG_ENABLED = false;
// 扩展重新加载后，旧页面里的 content script 会失去 chrome.runtime。
// 在启动阶段先缓存文案，失效时仍能给出可操作的提示。
const EXTENSION_RELOAD_NOTICE = {
  title: t("extensionReloadRequiredTitle"),
  message: t("extensionReloadRequiredMessage")
};
const TOAST_SAVE_ERROR_CLASS = "huojue-toast--save-error";
const CREATE_PROJECT_MESSAGE = "huojue:create-project";
const GET_PROJECTS_MESSAGE = "huojue:get-projects";
const MOVE_ASSETS_MESSAGE = "huojue:move-assets";
const UPLOAD_IMAGE_MESSAGE = "huojue:capture-image";
const REPLICATE_IMAGE_MESSAGE = "huojue:replicate-image";
const CONTEXT_MENU_RESULT_MESSAGE = "huojue:save-result";
const CONTEXT_MENU_PROGRESS_MESSAGE = "huojue:save-progress";
const GET_CONTEXT_TARGET_MESSAGE = "huojue:get-context-menu-target";
const OPEN_PAGE_MESSAGE = "huojue:open-page";
const MIN_HOVER_IMAGE_SIZE = 200;
const BATCH_FINAL_PROGRESS_DISPLAY_MS = 300;
const INSTAGRAM_POST_CACHE_MS = 5 * 60 * 1000;
const LOGIN_DETECTED_MESSAGE = "huojue:login-detected";
const LOGOUT_DETECTED_MESSAGE = "huojue:logout-detected";
const DISABLED_HOSTS_STORAGE_KEY = "huojueDisabledHosts";
/** 站点自身页面（含本地开发）不挂采集按钮：在自家界面上浮一层采集控件没有意义 */
const BLOCKED_EXTENSION_HOSTS = [
  "localhost",
  "127.0.0.1"
];
const VIDEO_MARKER_SELECTOR = [
  "video",
  '[data-type*="video" i]',
  '[data-note-type*="video" i]',
  '[data-media-type*="video" i]',
  '[data-testid*="video" i]',
  '[aria-label*="播放"]',
  '[title*="播放"]',
  '[aria-label*="play" i]',
  '[title*="play" i]'
].join(",");
const XIAOHONGSHU_CARD_SELECTOR = [
  "section.note-item",
  '[class*="note-item" i]',
  '[class*="feed-card" i]',
  "article",
  '[role="listitem"]',
  "li"
].join(",");
const XIAOHONGSHU_VIDEO_MARKER_SELECTOR = [
  ".play-icon",
  '[class*="play-icon" i]',
  '[class*="play-button" i]',
  '[class*="video-icon" i]',
  '[class*="video-badge" i]',
  'svg use[href*="play" i]',
  'svg use[href*="video" i]'
].join(",");
const PRODUCT_LINK_SELECTOR = [
  "a[href]",
  "a[data-href]",
  "a[data-url]",
  "a[data-link]",
  "a[data-product-url]"
].join(",");
const PRODUCT_LINK_URL_ATTRIBUTES = [
  "href",
  "data-href",
  "data-url",
  "data-link",
  "data-product-url"
];
const ITEM_TITLE_SELECTOR = [
  "[data-product-title]",
  "[data-item-title]",
  "[data-title]",
  '[data-testid*="title" i]',
  '[class*="title" i]',
  '[class*="name" i]',
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6"
].join(",");
const JD_PRODUCT_ITEM_SELECTOR = [
  '[data-sku]:not([data-sku=""])',
  '[data-sku-id]:not([data-sku-id=""])',
  '[data-skuid]:not([data-skuid=""])',
  '[data-spu]:not([data-spu=""])',
  ".gl-item",
  ".more2_item_good",
  ".recommend_cen .recommend_list .item",
  '[class*="sku-item" i]'
].join(",");
const COMMERCE_ITEM_SELECTOR = [
  '[data-asin]:not([data-asin=""])',
  '[data-product-id]',
  '[data-item-id]',
  '[data-sku]',
  '[itemtype*="schema.org/Product" i]',
  '[data-component-type="s-search-result"]',
  '[data-testid*="product-card" i]',
  '[data-testid*="product-item" i]',
  '[class*="product-card" i]',
  '[class*="product-item" i]',
  '[class*="goods-card" i]',
  '[class*="goods-item" i]',
  '[class*="listing-card" i]',
  '[class*="offer-item" i]',
  '[class*="search-result" i]',
  JD_PRODUCT_ITEM_SELECTOR
].join(",");
const COMMERCE_LIST_SELECTOR = [
  '[role="list"]',
  '[data-testid*="product-list" i]',
  '[data-testid*="product-grid" i]',
  '[class*="product-list" i]',
  '[class*="product-grid" i]',
  '[class*="goods-list" i]',
  '[class*="goods-grid" i]',
  '[class*="search-results" i]',
  ".s-main-slot",
  ".gl-warp",
  ".more2_list",
  ".recommend_cen .recommend_list",
  '[class*="sku-list" i]'
].join(",");
const GENERIC_ITEM_SELECTOR = [
  "article",
  "li",
  '[role="listitem"]',
  '[data-testid*="item" i]',
  '[data-testid*="card" i]'
].join(",");
const GENERIC_VISUAL_EXCLUDED_METADATA_PATTERN =
  /(?:^|[^a-z0-9])(?:banner|carousel|editorial|hero|nav|promo|slider|slick)(?:[^a-z0-9]|$)/i;
const imageCandidateFilter = globalThis.HuojueImageFilter || {
  hasAdDisclosureText: () => false,
  hasExcludedMetadata: () => false,
  isCategoryHref: () => false,
  isCommerceHost: () => false,
  isProductHref: () => false
};
const ACTION_ICON_CLASS = "huojue-image-action__icon";
const ACTION_ICON_PATHS = {
  batch: "content/assets/hover-batch.svg",
  replicate: "content/assets/hover-replicate.svg",
  save: "content/assets/hover-save.svg",
  chevron: "content/assets/hover-chevron.svg"
};

function createActionIcon(name) {
  const icon = document.createElement("img");
  icon.className = ACTION_ICON_CLASS;
  icon.src = chrome.runtime.getURL(ACTION_ICON_PATHS[name]);
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function setActionLabel(button, label, iconName) {
  button.replaceChildren(createActionIcon(iconName), document.createTextNode(label));
}

const actionButton = document.createElement("div");
actionButton.className = ACTION_CLASS;
actionButton.setAttribute("role", "group");
actionButton.setAttribute("aria-label", t("imageActions"));

const saveButton = document.createElement("button");
saveButton.type = "button";
saveButton.className = ACTION_PRIMARY_CLASS;
setActionLabel(saveButton, t("save"), "save");
saveButton.setAttribute("aria-label", t("saveImageToLibrary"));

const actionToggle = document.createElement("button");
actionToggle.type = "button";
actionToggle.className = ACTION_TOGGLE_CLASS;
actionToggle.append(createActionIcon("chevron"));
actionToggle.setAttribute("aria-label", t("expandMoreActions"));
actionToggle.setAttribute("aria-expanded", "false");

const actionMenu = document.createElement("div");
actionMenu.className = ACTION_MENU_CLASS;
actionMenu.inert = true;

const batchSaveButton = document.createElement("button");
batchSaveButton.type = "button";
batchSaveButton.className = `${ACTION_MENU_ITEM_CLASS} huojue-image-action__batch`;
batchSaveButton.hidden = true;
setActionLabel(batchSaveButton, t("batchSave"), "batch");

const replicateButton = document.createElement("button");
replicateButton.type = "button";
replicateButton.className = `${ACTION_MENU_ITEM_CLASS} huojue-image-action__replicate`;
setActionLabel(replicateButton, t("replicate"), "replicate");

actionMenu.append(batchSaveButton, replicateButton);
const saveControl = document.createElement("div");
saveControl.className = ACTION_SAVE_CONTROL_CLASS;
saveControl.append(saveButton, actionToggle);
actionButton.append(actionMenu, saveControl);

const toast = document.createElement("div");
toast.className = TOAST_CLASS;
toast.setAttribute("role", "region");
toast.setAttribute("aria-label", t("saveResult"));
const saveProgressToast = document.createElement("div");
saveProgressToast.className = "huojue-save-progress";
saveProgressToast.setAttribute("role", "status");
saveProgressToast.setAttribute("aria-live", "polite");
const saveProgressIcon = createToastIcon("toast-loading.svg");
const saveProgressLabel = document.createElement("span");
saveProgressLabel.textContent = `${t("saving")}…`;
saveProgressToast.append(saveProgressIcon, saveProgressLabel);
const batchBackdrop = document.createElement("div");
batchBackdrop.className = "huojue-batch-backdrop";
batchBackdrop.setAttribute("aria-hidden", "true");

const toastHeader = document.createElement("div");
toastHeader.className = TOAST_HEADER_CLASS;
const toastErrorIcon = createToastIcon("toast-error-alert.svg");
toastErrorIcon.classList.add("huojue-toast__error-icon");
const toastThumbnail = document.createElement("span");
toastThumbnail.className = "huojue-toast__thumbnail";
const toastAccount = document.createElement("div");
toastAccount.className = TOAST_ACCOUNT_CLASS;
const toastAccountCopy = document.createElement("div");
toastAccountCopy.className = "huojue-toast__account-copy";
toastAccountCopy.innerHTML = `<strong>${t("saveSuccess")}</strong>`;
const toastDestination = document.createElement("div");
toastDestination.className = "huojue-toast__destination";
const toastDestinationLabel = document.createElement("span");
toastDestinationLabel.textContent = t("savedTo");
const groupTrigger = document.createElement("button");
groupTrigger.type = "button";
groupTrigger.className = TOAST_GROUP_TRIGGER_CLASS;
groupTrigger.setAttribute("aria-label", t("selectFolder"));
groupTrigger.setAttribute("aria-expanded", "false");
const groupTriggerLabel = document.createElement("span");
groupTriggerLabel.textContent = t("uncategorized");
groupTrigger.append(groupTriggerLabel, createToastIcon("toast-chevron.svg"));
toastDestination.append(toastDestinationLabel, groupTrigger);
toastAccount.append(toastAccountCopy, toastDestination);
const viewButton = document.createElement("button");
viewButton.type = "button";
viewButton.className = TOAST_VIEW_CLASS;
viewButton.textContent = t("view");
toastHeader.append(toastErrorIcon, toastThumbnail, toastAccount, viewButton);

const groupPanel = document.createElement("div");
groupPanel.className = TOAST_GROUP_PANEL_CLASS;
groupPanel.hidden = true;
groupPanel.innerHTML =
  `<div class="huojue-toast__group-panel-heading"><span>${t("selectFolder")}</span><button type="button" class="huojue-toast__group-create">${t("newFolder")}</button></div>`;
const groupList = document.createElement("div");
groupList.className = TOAST_GROUP_LIST_CLASS;
groupPanel.append(groupList);
const groupCreate = groupPanel.querySelector(`.${TOAST_GROUP_CREATE_CLASS}`);
groupCreate.prepend(createToastIcon("toast-plus.svg"));
const groupCreateRow = document.createElement("div");
groupCreateRow.className = "huojue-toast__group-create-row";
groupCreateRow.hidden = true;
const groupCreateFolderIcon = createGroupFolderIcon();
const groupCreateInput = document.createElement("input");
groupCreateInput.className = "huojue-toast__group-input";
groupCreateInput.placeholder = t("enterFolderName");
groupCreateInput.maxLength = 128;
groupCreateInput.setAttribute("aria-label", t("newFolderName"));
groupCreateRow.append(
  groupCreateFolderIcon,
  groupCreateInput,
  createToastIcon("toast-radio-selected.svg")
);
groupList.append(groupCreateRow);

const toastUrl = document.createElement("span");
toastUrl.className = TOAST_URL_CLASS;

const toastStatus = document.createElement("span");
toastStatus.className = TOAST_STATUS_CLASS;
toastStatus.setAttribute("role", "status");
toastStatus.setAttribute("aria-live", "polite");
toastAccountCopy.append(toastStatus);

const toastActions = document.createElement("div");
toastActions.className = TOAST_ACTIONS_CLASS;

const copyButton = document.createElement("button");
copyButton.type = "button";
copyButton.className = TOAST_COPY_CLASS;
copyButton.textContent = t("copyAddress");

const uploadButton = document.createElement("button");
uploadButton.type = "button";
uploadButton.className = TOAST_UPLOAD_CLASS;
uploadButton.textContent = t("uploadToLibrary");

toastActions.append(copyButton, uploadButton);
const toastSeparator = document.createElement("div");
toastSeparator.className = "huojue-toast__separator";
toastSeparator.hidden = true;
toastActions.hidden = true;
uploadButton.textContent = t("save");

const batchPanel = document.createElement("section");
batchPanel.className = "huojue-toast__batch-panel";
batchPanel.hidden = true;
batchPanel.setAttribute("aria-label", t("batchSaveImages"));
const batchTitle = document.createElement("h2");
batchTitle.className = "huojue-toast__batch-title";
batchTitle.textContent = t("selectImages");
const batchCloseButton = document.createElement("button");
batchCloseButton.type = "button";
batchCloseButton.className = "huojue-toast__batch-close";
batchCloseButton.setAttribute("aria-label", t("closeBatchSelection"));
batchCloseButton.append(createToastIcon("toast-close.svg"));
const batchContent = document.createElement("div");
batchContent.className = "huojue-toast__batch-content";
const batchToolbar = document.createElement("div");
batchToolbar.className = "huojue-toast__batch-toolbar";
const batchSelectionStatus = document.createElement("span");
batchSelectionStatus.className = "huojue-toast__batch-selection";
batchSelectionStatus.setAttribute("role", "status");
batchSelectionStatus.setAttribute("aria-live", "polite");
const batchSelectToggle = document.createElement("button");
batchSelectToggle.type = "button";
batchSelectToggle.className = "huojue-toast__batch-select-toggle";
batchToolbar.append(batchSelectionStatus, batchSelectToggle);
const batchGrid = document.createElement("div");
batchGrid.className = "huojue-toast__batch-grid";
batchGrid.setAttribute("role", "group");
batchGrid.setAttribute("aria-label", t("batchImages"));
batchContent.append(batchToolbar, batchGrid);
const batchConfirmButton = document.createElement("button");
batchConfirmButton.type = "button";
batchConfirmButton.className = "huojue-toast__batch-save";
batchPanel.append(batchTitle, batchCloseButton, batchContent, batchConfirmButton);
const batchProgressPanel = document.createElement("section");
batchProgressPanel.className = "huojue-toast__batch-progress";
batchProgressPanel.hidden = true;
batchProgressPanel.setAttribute("role", "status");
batchProgressPanel.setAttribute("aria-live", "polite");
const batchProgressIcon = createToastIcon("toast-loading.svg");
batchProgressIcon.classList.add(
  "huojue-toast__batch-progress-icon"
);
const batchProgressText = document.createElement("span");
batchProgressText.className = "huojue-toast__batch-progress-text";
batchProgressPanel.append(batchProgressIcon, batchProgressText);
// Toast 按设计稿只保留保存结果、分组和查看入口；旧 URL/复制/上传按钮不再展示。
toast.append(
  batchProgressPanel,
  batchPanel,
  toastHeader,
  toastSeparator,
  groupPanel,
  toastActions
);

document.documentElement.append(actionButton);
if (isBlockedExtensionHost(location.hostname)) {
  actionButton.style.setProperty("display", "none", "important");
  toast.style.setProperty("display", "none", "important");
  saveProgressToast.style.setProperty("display", "none", "important");
}

let activeImage = null;
let hideTimer = null;
let toastTimer = null;
let positionFrame = null;
let positionWatchTimer = null;
let watchedImage = null;
let watchedImageRect = null;
let hoverPointer = null;
let hoverPointerFrame = null;
let uploadRequestId = 0;
let uploading = false;
let lastUploadSucceeded = false;
let hoverFeatureEnabled = !isBlockedExtensionHost(location.hostname);
let lastContextTarget = null;
let customCommercePageDetected = false;
let customCommercePageDetectionExpiresAt = 0;
const hoverEligibilityCache = new WeakMap();
const pinterestPinPropsCache = new WeakMap();
let instagramPostCache = null;
let selectedGroup = null;
let pendingGroup = null;
let projects = [];
let projectsLoading = false;
let projectsLoadRequestId = null;
let savingGroup = false;
let currentSourceUrl = "";
let currentSourceTitle = "";
let currentSourcePageUrl = "";
let currentSavedAssetIds = [];
let batchSaving = false;
let currentBatchItems = [];
let selectedBatchUrls = new Set();
let batchUploadedAssets = [];
const toastTitle = toastAccountCopy.querySelector("strong");
let toastHovered = false;
let currentContextMenuTraceId = null;

function createToastIcon(fileName) {
  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL(`content/assets/${fileName}`);
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function createGroupFolderIcon() {
  const container = document.createElement("span");
  container.className = "huojue-toast__group-folder-icon";
  container.setAttribute("aria-hidden", "true");
  container.append(createToastIcon("toast-folder.svg"));
  return container;
}

function revealToast() {
  if (!toast.isConnected) {
    document.documentElement.append(toast);
  }
  toast.classList.add(TOAST_VISIBLE_CLASS);
}

function showSingleSaveProgress() {
  toast.classList.remove(TOAST_VISIBLE_CLASS);
  toast.remove();
  toastHovered = false;
  document.documentElement.append(saveProgressToast);
}

function hideSingleSaveProgress() {
  saveProgressToast.remove();
}

function revealSaveResult() {
  hideSingleSaveProgress();
  revealToast();
}

function hasLiveExtensionContext() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function isExtensionContextInvalidError(error) {
  return error instanceof Error &&
    /extension context invalidated/i.test(error.message);
}

function showExtensionReloadNotice() {
  hideBatchBackdrop();
  hideSingleSaveProgress();
  uploadRequestId += 1;
  uploading = false;
  lastUploadSucceeded = false;
  toast.dataset.state = "error";
  toast.classList.remove(
    "huojue-toast--batch",
    "huojue-toast--batch-success"
  );
  toast.classList.add(TOAST_SAVE_ERROR_CLASS);
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-label", EXTENSION_RELOAD_NOTICE.title);
  setGroupPanelExpanded(false);
  toastSeparator.hidden = true;
  toastActions.hidden = true;
  toastTitle.textContent = EXTENSION_RELOAD_NOTICE.title;
  toastStatus.textContent = EXTENSION_RELOAD_NOTICE.message;
  toastUrl.textContent = "";
  revealSaveResult();
  cancelToastHide();
}

function showBatchBackdrop() {
  document.documentElement.append(batchBackdrop, toast);
  toast.setAttribute("role", "dialog");
  toast.setAttribute("aria-modal", "true");
  toast.setAttribute("aria-label", t("selectImages"));
  batchCloseButton.focus({ preventScroll: true });
}

function hideBatchBackdrop() {
  batchBackdrop.remove();
  toast.removeAttribute("aria-modal");
  if (toast.getAttribute("role") === "dialog") {
    toast.setAttribute("role", "region");
    toast.setAttribute("aria-label", t("saveResult"));
  }
}

function closeBatchSelection() {
  if (toast.dataset.batchView !== "selection") return;
  uploadRequestId += 1;
  batchSaving = false;
  cancelToastHide();
  hideBatchBackdrop();
  toast.classList.remove(TOAST_VISIBLE_CLASS);
  toast.classList.remove("huojue-toast--batch");
  delete toast.dataset.batchView;
  batchPanel.hidden = true;
  currentBatchItems = [];
  selectedBatchUrls.clear();
  batchGrid.replaceChildren();
  toast.remove();
  toastHovered = false;
}

function showSaveErrorToast(message, { loginRequired = false } = {}) {
  hideBatchBackdrop();
  lastUploadSucceeded = false;
  toast.dataset.state = "error";
  toast.classList.remove(
    "huojue-toast--batch",
    "huojue-toast--batch-success"
  );
  toast.classList.add(TOAST_SAVE_ERROR_CLASS);
  delete toast.dataset.batchView;
  batchPanel.hidden = true;
  batchProgressPanel.hidden = true;
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-label", t("saveFailedRetry"));
  setGroupPanelExpanded(false);
  toastSeparator.hidden = true;
  toastActions.hidden = true;
  toastTitle.textContent = t("saveFailedRetry");
  toastStatus.textContent = loginRequired
    ? message || t("loggedOutRetry")
    : isNetworkFetchError(message)
      ? t("networkConnectionError")
      : message || t("saveFailedSimple");
  uploadButton.disabled = false;
  uploadButton.textContent = loginRequired
    ? t("retryAfterLogin")
    : t("retryUpload");
  revealSaveResult();
  if (loginRequired) {
    cancelToastHide();
  } else {
    scheduleToastHide(8000);
  }
}

initializeSiteHoverSetting();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    Object.hasOwn(changes, DISABLED_HOSTS_STORAGE_KEY)
  ) {
    applySiteHoverSetting(changes[DISABLED_HOSTS_STORAGE_KEY].newValue);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === GET_CONTEXT_TARGET_MESSAGE) {
    sendResponse(
      hoverFeatureEnabled && lastContextTarget
        ? {
            imageUrl: lastContextTarget.imageUrl,
            sourceTitle: lastContextTarget.sourceTitle,
            sourcePageUrl: lastContextTarget.sourcePageUrl
          }
        : { imageUrl: null, sourceTitle: "", sourcePageUrl: "" }
    );
    return true;
  }

  if (message?.type === CONTEXT_MENU_RESULT_MESSAGE) {
    handleContextMenuResult(message);
    return;
  }

  if (message?.type === CONTEXT_MENU_PROGRESS_MESSAGE) {
    showToast(message.imageUrl || "", message.sourceTitle, message.sourcePageUrl, {
      mode: "progress"
    });
    currentContextMenuTraceId = message.traceId;
    return;
  }

  if (message?.type === LOGIN_DETECTED_MESSAGE) {
    debugUploadLog(message.traceId || "login", "检测到站点登录成功");
    uploading = false;
    lastUploadSucceeded = false;
    toast.classList.remove(TOAST_SAVE_ERROR_CLASS);
    toast.dataset.state = "loading";
    toast.setAttribute("role", "region");
    toast.setAttribute("aria-label", t("saveResult"));
    toastTitle.textContent = t("loginSuccess");
    toastStatus.textContent = t("loginContinue");
    toastSeparator.hidden = false;
    toastActions.hidden = false;
    uploadButton.disabled = false;
    uploadButton.textContent = t("continueUpload");
    revealSaveResult();
    cancelToastHide();
    return;
  }

  if (
    message?.type !== LOGOUT_DETECTED_MESSAGE ||
    lastUploadSucceeded
  ) {
    return;
  }

  debugUploadLog(message.traceId || "logout", "检测到站点退出登录");
  toastTitle.textContent = t("reloginRequired");
  uploadRequestId += 1;
  uploading = false;
  toastStatus.textContent = t("loggedOutRetry");
  uploadButton.disabled = false;
  uploadButton.textContent = t("loginAgain");
  revealSaveResult();
  cancelToastHide();
});

groupTrigger.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!lastUploadSucceeded) return;
  const expanded = groupPanel.hidden;
  setGroupPanelExpanded(expanded);
  if (expanded) {
    void loadProjects();
  }
});

document.addEventListener("pointerdown", handleOutsideGroupPanelPointer, true);

function handleOutsideGroupPanelPointer(event) {
  if (groupPanel.hidden || !toast.isConnected) return;
  if (event.composedPath().includes(toast)) return;
  setGroupPanelExpanded(false);
}

groupCreate.addEventListener("click", () => {
  pendingGroup = null;
  groupCreateRow.hidden = false;
  renderGroupList();
  groupCreateInput.focus();
});

groupCreateInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void saveSelectedGroup();
  } else if (event.key === "Escape") {
    groupCreateInput.value = "";
    groupCreateRow.hidden = true;
    pendingGroup = selectedGroup;
    renderGroupList();
    groupTrigger.focus();
  }
});

// 「查看」直达素材库并落在本次采集的分组上
viewButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({
    type: OPEN_PAGE_MESSAGE,
    page: "library",
    projectId: selectedGroup?.projectId
  });
});

// 使用事件委托，因此页面之后动态加载的图片也能生效。
document.addEventListener("pointerover", handlePointerOver, true);
document.addEventListener("pointerout", handlePointerOut, true);
document.addEventListener("pointermove", handleHoverPointerMove, true);
document.addEventListener("contextmenu", handleContextMenu, true);
document.addEventListener("scroll", schedulePositionUpdate, true);
window.addEventListener("resize", schedulePositionUpdate);
const modalObserver = new MutationObserver((mutations) => {
  if (activeImage && mutations.some(isModalMutation)) schedulePositionUpdate();
});
modalObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["open", "hidden", "aria-modal", "aria-hidden", "class", "style"]
});

actionButton.addEventListener("pointerenter", cancelScheduledHide);
actionButton.addEventListener("pointerleave", (event) => {
  if (event.relatedTarget === activeImage) {
    return;
  }

  scheduleHide();
});

saveButton.addEventListener("click", (event) => {
  // 避免点击悬浮按钮时触发网页图片本身的链接或点击事件。
  event.preventDefault();
  event.stopPropagation();

  if (!hasLiveExtensionContext()) {
    showExtensionReloadNotice();
    return;
  }
  if (!activeImage) {
    return;
  }

  showToast(
    activeImage.currentSrc || activeImage.src,
    getImageItemTitle(activeImage),
    getImageItemPageUrl(activeImage),
    { mode: "progress" }
  );
  void uploadCurrentImage();
});

actionToggle.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (activeImage) updateBatchSaveAction(activeImage);
  setActionMenuExpanded(!actionButton.classList.contains(ACTION_EXPANDED_CLASS));
  positionActionButton();
});

batchSaveButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!activeImage || actionMenu.inert) return;
  updateBatchSaveAction(activeImage);
  if (batchSaveButton.hidden) return;
  void showBatchToast(activeImage);
  collapseActionMenu();
});

async function showBatchToast(image) {
  const instagramExploreTile = getInstagramExploreCarouselTile(image);
  const instagramShortcode = (getInstagramCarouselViewport(image) || instagramExploreTile)
    ? getInstagramPostShortcode(image)
    : "";
  const instagramImageIdentity = instagramShortcode
    ? getInstagramImageIdentity(image.currentSrc || image.src)
    : "";
  let instagramImageUrls = null;
  showToast(
    image.currentSrc || image.src,
    getImageItemTitle(image),
    getImageItemPageUrl(image)
  );
  const requestId = uploadRequestId;
  if (instagramShortcode) {
    toast.classList.add("huojue-toast--batch");
    toast.dataset.batchView = "progress";
    batchPanel.hidden = true;
    batchProgressPanel.hidden = false;
    batchProgressText.textContent = t("popupLoading");
    cancelToastHide();
    try {
      const urls = await loadInstagramPostImageUrls(instagramShortcode);
      if (requestId !== uploadRequestId) return;
      if (getInstagramPostShortcode(image) !== instagramShortcode) {
        toast.classList.remove(TOAST_VISIBLE_CLASS);
        toast.remove();
        return;
      }
      if (urls.length < 2 || (!instagramExploreTile && !urls.some((url) =>
        getInstagramImageIdentity(url) === instagramImageIdentity))) {
        throw new Error(t("batchLoadFailed"));
      }
      instagramImageUrls = urls;
    } catch {
      if (requestId !== uploadRequestId) return;
      showSaveErrorToast(t("batchLoadFailed"));
      return;
    }
  }
  if (requestId !== uploadRequestId) return;
  toast.classList.add("huojue-toast--batch");
  toast.dataset.batchView = "selection";
  batchPanel.hidden = false;
  batchProgressPanel.hidden = true;
  setGroupPanelExpanded(false);
  batchSaving = false;
  currentBatchItems = collectBatchImages(image, instagramImageUrls);
  selectedBatchUrls = new Set(currentBatchItems.map((item) => item.url));
  renderBatchGrid();
  updateBatchSelectionUi();
  cancelToastHide();
  showBatchBackdrop();
}

function collectBatchImages(primaryImage, loadedInstagramUrls = null) {
  const instagramImageUrls = loadedInstagramUrls ||
    getInstagramCachedPostImageUrls(primaryImage);
  const taobaoGalleryUrls = getTaobaoProductGalleryImageUrls(primaryImage);
  const rednoteImageUrls = getRednoteNoteImageUrls(primaryImage);
  const scopedImageUrls = instagramImageUrls?.length > 1
    ? instagramImageUrls
    : taobaoGalleryUrls.length > 1
      ? taobaoGalleryUrls
      : rednoteImageUrls.length > 1
        ? rednoteImageUrls
        : getPinterestPinCarouselImageUrls(primaryImage);
  if (scopedImageUrls.length > 1) {
    const sourceTitle = getImageItemTitle(primaryImage);
    const sourcePageUrl = getImageItemPageUrl(primaryImage);
    return scopedImageUrls.map((url, index) => ({
      image: primaryImage,
      url,
      sourceTitle,
      sourcePageUrl: instagramImageUrls?.length > 1
        ? getInstagramIndexedPostUrl(url, sourcePageUrl, index + 1)
        : sourcePageUrl
    }));
  }

  const seen = new Set();
  const group = findBatchImageGroup(primaryImage);
  const candidates = group
    ? [primaryImage, ...Array.from(group.querySelectorAll("img"))]
    : [primaryImage];
  const items = [];

  for (const image of candidates) {
    const url = getBatchImageUrl(image, primaryImage);
    const identity = getBatchImageIdentity(url);
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    items.push({
      image,
      url,
      sourceTitle: getImageItemTitle(image),
      sourcePageUrl: getImageItemPageUrl(image)
    });
  }

  return items;
}

function updateBatchSaveAction(image) {
  batchSaveButton.hidden = !hasBatchImageGroup(image);
}

function hasBatchImageGroup(image) {
  if (getInstagramExploreCarouselTile(image)) return true;
  const instagramViewport = getInstagramCarouselViewport(image);
  if (instagramViewport) {
    const cachedUrls = getInstagramCachedPostImageUrls(image);
    return cachedUrls === null
      ? instagramViewport.querySelectorAll("ul > li").length > 1
      : cachedUrls.length > 1;
  }
  if (getTaobaoProductGalleryImageUrls(image).length > 1) return true;
  return (
    getRednoteNoteImageUrls(image).length > 1 ||
    getPinterestPinCarouselImageUrls(image).length > 1 ||
    Boolean(findBatchImageGroup(image))
  );
}

function isTaobaoProductDetailPage() {
  const host = location.hostname.toLowerCase();
  if (host !== "detail.tmall.com" && host !== "item.taobao.com") return false;
  if (!/^\/item\.htm$/i.test(location.pathname)) return false;
  try {
    return /^\d+$/.test(new URL(location.href).searchParams.get("id") || "");
  } catch {
    return false;
  }
}

function getTaobaoGalleryImageUrl(image) {
  const sources = [
    image.getAttribute("data-src"),
    image.getAttribute("data-ks-lazyload"),
    image.getAttribute("data-lazy-src"),
    image.currentSrc,
    image.src
  ];
  for (const source of sources) {
    if (!source) continue;
    try {
      const url = new URL(source, location.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (/(^|\.)(?:alicdn\.com|taobaocdn\.com|tbcdn\.cn)$/i.test(url.hostname)) {
        // 淘宝 CDN 在原图扩展名后追加 _60x60q90.jpg 等缩略图后缀。
        url.pathname = url.pathname.replace(
          /\.(jpe?g|png|webp|gif|avif)_[^/]+$/i,
          ".$1"
        );
      }
      return url.href;
    } catch {
      // 忽略尚未加载的占位图地址。
    }
  }
  return "";
}

function getTaobaoGalleryImageIdentity(url) {
  try {
    const parsed = new URL(url, location.href);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "";
  }
}

function getTaobaoProductGalleryImageUrls(primaryImage) {
  if (!isTaobaoProductDetailPage() || !primaryImage) return [];
  const mainRect = primaryImage.getBoundingClientRect();
  if (mainRect.width < MIN_HOVER_IMAGE_SIZE ||
      mainRect.height < MIN_HOVER_IMAGE_SIZE ||
      isVideoItemImage(primaryImage)) return [];

  const mainUrl = getTaobaoGalleryImageUrl(primaryImage);
  if (!mainUrl) return [];
  const left = [];
  const below = [];
  for (const image of document.querySelectorAll("img")) {
    if (image === primaryImage || isVideoItemImage(image)) continue;
    const rect = image.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 30 ||
        rect.width > 160 || rect.height > 160) continue;
    const url = getTaobaoGalleryImageUrl(image);
    if (!url) continue;
    const item = { rect, url };
    if (rect.right <= mainRect.left + 20 &&
        mainRect.left - rect.right <= 240 &&
        rect.bottom > mainRect.top - 60 &&
        rect.top < mainRect.bottom + 60) {
      left.push(item);
    } else if (rect.top >= mainRect.bottom - 50 &&
        rect.top - mainRect.bottom <= 180 &&
        rect.right > mainRect.left &&
        rect.left < mainRect.right) {
      below.push(item);
    }
  }

  // 只取与主图相邻的一列或一排缩略图；不能把右侧放大图和推荐商品混进组图。
  const alignedLeft = left.length
    ? left.filter(({ rect }) => Math.abs(rect.left - left[0].rect.left) <= 40)
    : [];
  const alignedBelow = below.length
    ? below.filter(({ rect }) => Math.abs(rect.top - below[0].rect.top) <= 40)
    : [];
  const thumbnails = alignedLeft.length >= alignedBelow.length
    ? alignedLeft.sort((a, b) => a.rect.top - b.rect.top)
    : alignedBelow.sort((a, b) => a.rect.left - b.rect.left);
  if (thumbnails.length < 2) return [];

  const urls = new Map();
  for (const { url } of thumbnails) {
    const identity = getTaobaoGalleryImageIdentity(url);
    if (identity && !urls.has(identity)) urls.set(identity, url);
  }
  const mainIdentity = getTaobaoGalleryImageIdentity(mainUrl);
  if (mainIdentity) urls.set(mainIdentity, mainUrl);
  return urls.size > 1 ? [...urls.values()] : [];
}

function isTaobaoDetailZoomCopy(image) {
  if (!isTaobaoProductDetailPage()) return false;
  const imageRect = image.getBoundingClientRect();
  const imageUrl = getTaobaoGalleryImageUrl(image);
  if (!imageUrl) return false;
  const identity = getTaobaoGalleryImageIdentity(imageUrl);

  return Array.from(document.querySelectorAll("img")).some((candidate) => {
    if (candidate === image) return false;
    const rect = candidate.getBoundingClientRect();
    const overlap = Math.min(rect.bottom, imageRect.bottom) -
      Math.max(rect.top, imageRect.top);
    if (rect.width < MIN_HOVER_IMAGE_SIZE ||
        rect.height < MIN_HOVER_IMAGE_SIZE ||
        rect.right > imageRect.left + 20 ||
        imageRect.left - rect.right > 240 ||
        overlap < Math.min(rect.height, imageRect.height) * 0.6) return false;
    return getTaobaoGalleryImageIdentity(getTaobaoGalleryImageUrl(candidate)) === identity;
  });
}

function getInstagramPostShortcode(image = null) {
  if (!/(^|\.)instagram\.com$/i.test(location.hostname)) return "";
  const pageShortcode = location.pathname.match(
    /^\/(?:[^/]+\/)?p\/([a-z0-9_-]+)\/?$/i
  )?.[1] || "";
  if (!image) return pageShortcode;
  const postUrl = getInstagramItemPostUrl(image);
  const itemShortcode = postUrl && new URL(postUrl, location.href).pathname.match(
    /^\/(?:[^/]+\/)?p\/([a-z0-9_-]+)\/?$/i
  )?.[1];
  return pageShortcode && itemShortcode !== pageShortcode
    ? ""
    : itemShortcode || "";
}

function getInstagramExploreCarouselTile(image) {
  if (!image || !/(^|\.)instagram\.com$/i.test(location.hostname) ||
      !/^\/explore\/?$/i.test(location.pathname)) return null;
  const link = image.closest('a[href]');
  const postUrl = link && getNavigableItemUrl(link);
  if (!postUrl || !/^\/(?:[^/]+\/)?p\/[a-z0-9_-]+\/?$/i.test(
    new URL(postUrl).pathname
  )) return null;

  // Explore 的卡片只渲染封面；只接受当前卡片明确的组图徽标。
  const parent = link.parentElement;
  const scope = parent?.querySelectorAll('a[href*="/p/"]').length === 1
    ? parent : link;
  const badge = Array.from(scope.querySelectorAll('[aria-label], [title]')).some((node) => {
    if (node === image || node instanceof HTMLImageElement) return false;
    const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`;
    return /carousel|multiple (?:photos|images)|轮播|多图|多张|相册|カルーセル|複数|캐러셀/i.test(label);
  });
  return badge ? link : null;
}

function getInstagramCarouselViewport(image) {
  if (!image) return null;
  const shortcode = getInstagramPostShortcode(image);
  if (!shortcode) return null;
  const slide = image.closest("li");
  const list = slide?.parentElement;
  const viewport = list?.closest('[role="presentation"]');
  if (list?.tagName !== "UL" || !viewport) return null;
  const postContainer = image.closest("article") || image.closest('[role="dialog"]');
  if (!getInstagramPostShortcode() &&
      (!postContainer || !postContainer.contains(viewport))) return null;
  const linkedPost = viewport?.closest('a[href*="/p/"]');
  if (linkedPost) {
    try {
      const linkedPath = new URL(linkedPost.getAttribute("href"), location.href).pathname;
      if (linkedPath.match(/^\/(?:[^/]+\/)?p\/([a-z0-9_-]+)\/?$/i)?.[1] !==
          shortcode) return null;
    } catch {
      return null;
    }
  }
  return viewport.getAttribute("role") === "presentation" &&
    list.querySelectorAll(":scope > li").length > 1
    ? viewport
    : null;
}

function getInstagramImageIdentity(url) {
  try {
    const parsed = new URL(url, location.href);
    if (parsed.protocol !== "https:" ||
        !/(^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(parsed.hostname)) return "";
    return parsed.pathname.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") || "";
  } catch {
    return "";
  }
}

function getInstagramIndexedPostUrl(imageUrl, postUrl, fallbackIndex) {
  const url = new URL(postUrl, location.href);
  if (!/(^|\.)instagram\.com$/i.test(url.hostname) ||
      !/^\/(?:[^/]+\/)?p\/[a-z0-9_-]+\/?$/i.test(url.pathname)) {
    return postUrl;
  }
  const identity = getInstagramImageIdentity(imageUrl);
  const postShortcode = url.pathname.match(
    /^\/(?:[^/]+\/)?p\/([a-z0-9_-]+)\/?$/i
  )?.[1];
  const imageIndex = instagramPostCache?.shortcode === postShortcode
    ? instagramPostCache.imageIndexes?.get(identity) || fallbackIndex
    : fallbackIndex;
  url.searchParams.set("img_index", String(imageIndex));
  return url.href;
}

function getInstagramCachedPostImageUrls(image) {
  const exploreTile = getInstagramExploreCarouselTile(image);
  if (!getInstagramCarouselViewport(image) && !exploreTile) return null;
  const shortcode = getInstagramPostShortcode(image);
  if (instagramPostCache?.shortcode !== shortcode ||
      instagramPostCache.expiresAt <= Date.now()) return null;
  const identity = getInstagramImageIdentity(image.currentSrc || image.src);
  const matchesCurrentSlide = identity && instagramPostCache.urls.some((url) =>
    getInstagramImageIdentity(url) === identity);
  return exploreTile || matchesCurrentSlide ? instagramPostCache.urls
    : [];
}

async function loadInstagramPostImageUrls(shortcode) {
  if (!/^[a-z0-9_-]+$/i.test(shortcode || "")) return [];
  if (instagramPostCache?.shortcode === shortcode) {
    if (instagramPostCache.expiresAt > Date.now()) {
      return instagramPostCache.urls;
    }
    if (instagramPostCache.promise) return instagramPostCache.promise;
  }

  const entry = {
    shortcode,
    urls: [],
    imageIndexes: new Map(),
    expiresAt: 0,
    promise: null
  };
  instagramPostCache = entry;
  entry.promise = (async () => {
    const response = await fetch(`/p/${encodeURIComponent(shortcode)}/embed/`, {
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Instagram embed HTTP ${response.status}`);
    const images = parseInstagramEmbedImages(await response.text(), shortcode);
    const urls = images.map((image) => image.url);
    if (urls.length < 2) throw new Error("Instagram image group unavailable");
    entry.urls = urls;
    entry.imageIndexes = new Map(images.map(({ url, index }) => [
      getInstagramImageIdentity(url), index
    ]));
    entry.expiresAt = Date.now() + INSTAGRAM_POST_CACHE_MS;
    return urls;
  })();
  try {
    return await entry.promise;
  } finally {
    entry.promise = null;
  }
}

function parseInstagramEmbedImages(html, shortcode) {
  const page = new DOMParser().parseFromString(html, "text/html");
  for (const script of page.querySelectorAll("script")) {
    const text = script.textContent || "";
    if (!text.includes("edge_sidecar_to_children")) continue;
    const start = text.indexOf("s.handle(");
    const end = text.indexOf(");requireLazy(", start);
    if (start < 0 || end < 0) continue;
    let payload;
    try {
      payload = JSON.parse(text.slice(start + "s.handle(".length, end));
    } catch {
      continue;
    }
    const pending = [payload];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === "string") {
        if (!value.includes("edge_sidecar_to_children")) continue;
        let post;
        try {
          post = JSON.parse(value);
        } catch {
          continue;
        }
        const media = post?.gql_data?.shortcode_media;
        if (post?.context?.shortcode !== shortcode ||
            media?.shortcode !== shortcode ||
            media?.__typename !== "GraphSidecar") continue;
        const images = [];
        const identities = new Set();
        for (const [position, edge] of
          (media.edge_sidecar_to_children?.edges || []).entries()) {
          if (edge?.node?.is_video) continue;
          const url = edge?.node?.display_url;
          const identity = getInstagramImageIdentity(url);
          if (!identity || identities.has(identity)) continue;
          identities.add(identity);
          images.push({ url, index: position + 1 });
        }
        return images;
      }
      if (value && typeof value === "object") {
        pending.push(...Object.values(value));
      }
    }
  }
  return [];
}

function getRednoteNoteImageUrls(primaryImage) {
  if (
    !/(^|\.)rednote\.com$/i.test(location.hostname) ||
    !/^\/discovery\/item\/[a-z0-9]+$/i.test(location.pathname) ||
    !primaryImage.closest("#noteContainer .media-container .xhs-slider-container")
  ) {
    return [];
  }

  const noteUrl = document.querySelector('meta[property="og:url"]')?.content;
  try {
    const canonicalUrl = new URL(noteUrl);
    if (
      canonicalUrl.origin !== location.origin ||
      canonicalUrl.pathname !== location.pathname
    ) {
      return [];
    }
  } catch {
    return [];
  }

  const urls = [];
  const identities = new Set();
  for (const meta of document.querySelectorAll('meta[property="og:image"]')) {
    const url = meta.content;
    const identity = getRednoteImageIdentity(url);
    if (!identity || identities.has(identity)) continue;
    identities.add(identity);
    urls.push(url);
  }

  const primaryIdentity = getRednoteImageIdentity(
    primaryImage.currentSrc || primaryImage.src
  );
  const paginationCount = document.querySelectorAll(
    "#noteContainer .slider-pagination-container .pagination-item"
  ).length;
  if (
    !primaryIdentity ||
    !identities.has(primaryIdentity) ||
    (paginationCount > 1 && paginationCount !== urls.length)
  ) {
    return [];
  }
  return urls;
}

function getRednoteImageIdentity(url) {
  try {
    const imageUrl = new URL(url, location.href);
    if (!["http:", "https:"].includes(imageUrl.protocol)) return "";
    return imageUrl.pathname.split("/").pop()?.split("!")[0] || "";
  } catch {
    return "";
  }
}

function getPinterestPinData() {
  if (!isPinterestPinDetailPage()) return null;
  const pinId = location.pathname.match(/(\d+)\/?$/)?.[1];
  const script = document.getElementById("__PWS_INITIAL_PROPS__");
  if (!pinId || !script) return null;

  const text = script.textContent || "";
  let cached = pinterestPinPropsCache.get(script);
  if (!cached || cached.text !== text) {
    let pins = null;
    try {
      pins = JSON.parse(text)?.initialReduxState?.pins || null;
    } catch {
      // Pinterest 有时只返回应用壳；此时交给下方的 DOM 相册兜底。
    }
    cached = { text, pins };
    pinterestPinPropsCache.set(script, cached);
  }
  const pin = cached.pins?.[pinId];
  return String(pin?.id) === pinId ? pin : null;
}

function getPinterestPinCarouselImageUrls(primaryImage) {
  const slots = getPinterestPinData()?.carousel_data?.carousel_slots;
  if (!Array.isArray(slots) || slots.length < 2) return [];

  const urls = [];
  const identities = new Set();
  for (const slot of slots) {
    if (slot.videos) continue;
    const images = slot.images;
    const url = images?.["736x"]?.url || images?.["564x"]?.url ||
      images?.["474x"]?.url || images?.["236x"]?.url;
    if (!url) continue;
    try {
      const parsed = new URL(url, location.href);
      if (parsed.protocol !== "https:" ||
          !/(^|\.)pinimg\.com$/i.test(parsed.hostname)) continue;
    } catch {
      continue;
    }
    const identity = getBatchImageIdentity(url);
    if (identities.has(identity)) continue;
    identities.add(identity);
    urls.push(url);
  }

  const activeIdentity = getBatchImageIdentity(primaryImage.currentSrc || primaryImage.src);
  return urls.length > 1 && identities.has(activeIdentity) ? urls : [];
}

function findBatchImageGroup(primaryImage) {
  // 详情页已有当前 Pin 的结构化数据时，它比 DOM 中的主图、副本和推荐图可靠。
  if (isPinterestPinDetailPage() && getPinterestPinData()) return null;
  const explicitGroupSelector = [
    '[data-gallery]',
    '[data-testid*="gallery" i]',
    '[data-testid*="carousel" i]',
    '[data-test-id*="gallery" i]',
    '[data-test-id*="carousel" i]',
    '[class*="gallery" i]',
    '[class*="carousel" i]',
    '[class*="swiper" i]',
    '[class*="slider" i]',
    '[class*="album" i]'
  ].join(",");
  const itemSelector = [
    "article",
    "li",
    '[role="listitem"]',
    '[data-testid*="card" i]',
    '[data-test-id*="card" i]',
    '[class*="card" i]',
    '[class*="product-item" i]'
  ].join(",");
  const pinterestPinDetail = isPinterestPinDetailPage();
  let ancestor = primaryImage.parentElement;

  while (
    ancestor &&
    ancestor !== document.body &&
    ancestor !== document.documentElement &&
    ancestor.tagName !== "MAIN"
  ) {
    if (
      ancestor.matches(explicitGroupSelector) &&
      countEligibleBatchImages(ancestor, primaryImage) > 1
    ) {
      return ancestor;
    }
    if (
      ancestor.matches(itemSelector) &&
      !ancestor.matches(
        '[class*="slide" i], [data-swiper-slide-index], [data-slide-index]'
      )
    ) {
      // 单个 Pin 的卡片可能同时渲染主图和预览副本；仅真正的相册容器
      // 才能在详情页触发批量保存，不能把卡片或右侧推荐区当成组图。
      if (pinterestPinDetail) return null;
      return countEligibleBatchImages(ancestor, primaryImage) > 1
        ? ancestor
        : null;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function countEligibleBatchImages(container, primaryImage) {
  const urls = new Set();
  for (const image of container.querySelectorAll("img")) {
    const url = getBatchImageUrl(image, primaryImage);
    const identity = getBatchImageIdentity(url);
    if (identity) urls.add(identity);
    if (urls.size > 1) break;
  }
  return urls.size;
}

function getBatchImageIdentity(url) {
  if (!url || !isPinterestPage()) return url;
  try {
    const imageUrl = new URL(url, location.href);
    if (!/(^|\.)pinimg\.com$/i.test(imageUrl.hostname)) return url;
    const parts = imageUrl.pathname.split("/").filter(Boolean);
    // pinimg 为同一张图提供 236x、736x、originals 等不同地址和格式。
    // 用其内容路径去重，而不是把尺寸/格式变化误算为第二张图片。
    if (/^(?:originals|\d+x(?:\d+)?)$/i.test(parts[0])) parts.shift();
    if (!parts.length) return url;
    parts[parts.length - 1] = parts[parts.length - 1].replace(/\.[a-z0-9]+$/i, "");
    return `${imageUrl.hostname}/${parts.join("/")}`;
  } catch {
    return url;
  }
}

function getBatchImageUrl(image, primaryImage) {
  if (
    !(image instanceof HTMLImageElement) ||
    isVideoItemImage(image) ||
    (isCommercePage() && isExcludedCommerceImage(image))
  ) {
    return "";
  }
  if (
    image !== primaryImage &&
    (image.width <= 80 || image.height <= 80)
  ) {
    return "";
  }
  return image.currentSrc || image.src || "";
}

function renderBatchGrid() {
  batchGrid.replaceChildren();
  currentBatchItems.forEach(({ image, url }, index) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "huojue-toast__batch-item";
    tile.dataset.batchIndex = String(index);
    const thumbnail = document.createElement("img");
    thumbnail.className = "huojue-toast__batch-image";
    thumbnail.src = url;
    thumbnail.alt = image.alt || t("pendingImage", String(index + 1));
    thumbnail.loading = "lazy";
    thumbnail.decoding = "async";
    const checkbox = document.createElement("span");
    checkbox.className = "huojue-toast__batch-checkbox";
    checkbox.setAttribute("aria-hidden", "true");
    checkbox.append(createToastIcon("toast-check.svg"));
    tile.append(thumbnail, checkbox);
    tile.addEventListener("click", () => {
      if (batchSaving) return;
      if (selectedBatchUrls.has(url)) {
        selectedBatchUrls.delete(url);
      } else {
        selectedBatchUrls.add(url);
      }
      updateBatchSelectionUi();
    });
    batchGrid.append(tile);
  });
}

function updateBatchSelectionUi() {
  const selectedCount = selectedBatchUrls.size;
  const totalCount = currentBatchItems.length;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  batchSelectionStatus.textContent = t("selectedImages", String(selectedCount));
  batchSelectToggle.textContent = allSelected ? t("deselectAll") : t("selectAll");
  batchSelectToggle.setAttribute("aria-pressed", String(allSelected));
  batchSelectToggle.disabled = batchSaving || totalCount === 0;
  batchConfirmButton.textContent = t("saveSelection", [
    String(selectedCount),
    String(totalCount)
  ]);
  batchConfirmButton.disabled = batchSaving || selectedCount === 0;

  for (const tile of batchGrid.children) {
    const index = Number(tile.dataset.batchIndex);
    const item = currentBatchItems[index];
    const selected = Boolean(item && selectedBatchUrls.has(item.url));
    tile.setAttribute("aria-pressed", String(selected));
    tile.setAttribute(
      "aria-label",
      t(selected ? "deselectImage" : "selectImage", String(index + 1))
    );
    tile.disabled = batchSaving;
  }
}

batchSelectToggle.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (batchSaving) return;
  if (
    currentBatchItems.length > 0 &&
    selectedBatchUrls.size === currentBatchItems.length
  ) {
    selectedBatchUrls.clear();
  } else {
    selectedBatchUrls = new Set(currentBatchItems.map((item) => item.url));
  }
  updateBatchSelectionUi();
});

batchConfirmButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void saveSelectedBatch();
});

batchCloseButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeBatchSelection();
});

toast.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || toast.dataset.batchView !== "selection") return;
  event.preventDefault();
  closeBatchSelection();
});

async function saveSelectedBatch() {
  if (batchSaving || selectedBatchUrls.size === 0) return;

  const selectedItems = currentBatchItems.filter((item) =>
    selectedBatchUrls.has(item.url)
  );
  const urls = selectedItems.map((item) => item.url);
  const requestId = ++uploadRequestId;
  const retryUrls = [];
  let loginRequired = false;
  let firstFailureMessage = null;
  batchSaving = true;
  cancelToastHide();
  updateBatchSelectionUi();
  let preferredProject = null;
  try {
    preferredProject = await loadProjects({
      throwOnError: true
    });
  } catch (error) {
    if (requestId !== uploadRequestId) return;
    batchSaving = false;
    updateBatchSelectionUi();
    showSaveErrorToast(toUserMessage(error), {
      loginRequired: Boolean(error?.loginRequired)
    });
    return;
  }
  if (requestId !== uploadRequestId) return;

  let processedCount = 0;
  showBatchProgress(processedCount, urls.length);
  for (let index = 0; index < urls.length; index += 1) {
    if (requestId !== uploadRequestId) return;
    const traceId = createUploadTraceId();
    try {
      const response = await chrome.runtime.sendMessage({
        type: UPLOAD_IMAGE_MESSAGE,
        imageUrl: urls[index],
        sourceTitle: selectedItems[index].sourceTitle,
        sourcePageUrl: selectedItems[index].sourcePageUrl,
        projectId: preferredProject?.projectId,
        traceId
      });
      if (requestId !== uploadRequestId) return;
      if (!response?.ok || !response.url || !response.assetId) {
        loginRequired = Boolean(response?.loginRequired);
        throw new Error(response?.error || t("saveFailedRetry"));
      }
      batchUploadedAssets.push({
        assetId: response.assetId,
        sourceUrl: urls[index],
        url: response.url
      });
    } catch (error) {
      retryUrls.push(urls[index]);
      firstFailureMessage ??= toUserMessage(error);
      debugUploadError(traceId, "批量保存图片失败", error);
      if (loginRequired) {
        retryUrls.push(...urls.slice(index + 1));
      }
    } finally {
      if (requestId === uploadRequestId) {
        processedCount = index + 1;
        showBatchProgress(processedCount, urls.length);
      }
    }

    if (loginRequired) break;
  }

  if (requestId !== uploadRequestId) return;
  if (processedCount === urls.length) {
    await waitForBatchFinalProgress();
    if (requestId !== uploadRequestId) return;
  }
  batchSaving = false;

  if (
    batchUploadedAssets.length > 0 &&
    (!loginRequired || retryUrls.length === 0)
  ) {
    showBatchSuccessToast(
      batchUploadedAssets.length,
      batchUploadedAssets[0]?.sourceUrl || urls[0],
      preferredProject,
      retryUrls.length > 0
    );
    return;
  }

  if (batchUploadedAssets.length === 0) {
    showSaveErrorToast(
      loginRequired ? t("loggedOutRetry") : firstFailureMessage,
      { loginRequired }
    );
    return;
  }

  selectedBatchUrls = new Set(retryUrls);
  toast.dataset.batchView = "selection";
  batchPanel.hidden = false;
  batchProgressPanel.hidden = true;
  updateBatchSelectionUi();
  toast.dataset.state = "error";
  batchSelectionStatus.textContent = loginRequired
    ? t("savedThenLogin", [
        String(batchUploadedAssets.length),
        String(retryUrls.length)
      ])
    : t("savedWithFailures", [
        String(batchUploadedAssets.length),
        String(retryUrls.length)
      ]);
  batchConfirmButton.textContent = loginRequired
    ? t("loginRetrySelection", [
        String(retryUrls.length),
        String(currentBatchItems.length)
      ])
    : t("retrySelection", [
        String(retryUrls.length),
        String(currentBatchItems.length)
      ]);
  cancelToastHide();
  showBatchBackdrop();
}

function showBatchProgress(savedCount, totalCount) {
  hideBatchBackdrop();
  toast.dataset.state = "loading";
  toast.dataset.batchView = "progress";
  batchPanel.hidden = true;
  batchProgressPanel.hidden = false;
  batchProgressText.textContent = t("savingProgress", [
    String(savedCount),
    String(totalCount)
  ]);
}

function waitForBatchFinalProgress() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, BATCH_FINAL_PROGRESS_DISPLAY_MS);
  });
}

function showBatchSuccessToast(
  savedCount,
  thumbnailUrl,
  project = null,
  partial = false
) {
  hideBatchBackdrop();
  toast.classList.remove(
    "huojue-toast--batch",
    TOAST_SAVE_ERROR_CLASS
  );
  toast.classList.add("huojue-toast--batch-success");
  delete toast.dataset.batchView;
  toast.dataset.state = "success";
  batchPanel.hidden = true;
  batchProgressPanel.hidden = true;
  lastUploadSucceeded = true;
  selectedGroup = project;
  pendingGroup = project;
  currentSavedAssetIds = batchUploadedAssets
    .map((asset) => asset.assetId)
    .filter(Boolean);
  currentSourceUrl = batchUploadedAssets[0]?.sourceUrl || thumbnailUrl || "";
  toastUrl.textContent = batchUploadedAssets[0]?.url || "";
  toastThumbnail.style.backgroundImage = thumbnailUrl
    ? `url("${String(thumbnailUrl).replaceAll('"', "%22")}")`
    : "none";
  toastTitle.textContent = t(partial ? "partialSaveSuccess" : "saveSuccess");
  toastStatus.textContent = "";
  toastDestinationLabel.textContent = t("batchSavedTo", String(savedCount));
  updateGroupLabel();
  setGroupPanelExpanded(false);
  revealToast();
  scheduleToastHide(5000);
}

replicateButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!activeImage || actionMenu.inert) return;
  const sourceUrl = activeImage.currentSrc || activeImage.src;
  showToast(sourceUrl);
  toastStatus.textContent = t("replicateUploading");
  void startImageReplication(sourceUrl);
  collapseActionMenu();
});

async function startImageReplication(sourceUrl) {
  const traceId = createUploadTraceId();
  try {
    const response = await chrome.runtime.sendMessage({
      type: REPLICATE_IMAGE_MESSAGE,
      imageUrl: sourceUrl,
      traceId
    });
    if (!response?.ok) {
      throw new Error(response?.error || t("replicateFailed"));
    }
    toastStatus.textContent = t("replicateOpening");
  } catch (error) {
    toastStatus.textContent = toUserMessage(error);
    debugUploadError(traceId, "图片复刻准备失败", error);
  }
}

toast.addEventListener("pointerenter", () => {
  toastHovered = true;
  cancelToastHide();
});
toast.addEventListener("pointerleave", () => {
  toastHovered = false;
  scheduleToastHide(3000);
});
copyButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();

  try {
    await copyText(toastUrl.textContent);
    copyButton.textContent = t("copied");
    toastStatus.textContent = t("addressCopied");
  } catch {
    copyButton.textContent = t("copyFailed");
    toastStatus.textContent = t("copyFailedManual");
  }

  if (!uploading) {
    scheduleToastHide(3000);
  }
});

uploadButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!hasLiveExtensionContext()) {
    showExtensionReloadNotice();
    return;
  }
  if (lastUploadSucceeded) {
    await saveSelectedGroup();
  } else {
    await uploadCurrentImage();
  }
});

async function uploadCurrentImage() {
  if (!hasLiveExtensionContext()) {
    showExtensionReloadNotice();
    return;
  }
  if (uploading) {
    return;
  }

  const sourceUrl = currentSourceUrl;
  if (!sourceUrl) {
    return;
  }
  const traceId = createUploadTraceId();
  const requestId = ++uploadRequestId;
  uploading = true;
  lastUploadSucceeded = false;
  cancelToastHide();
  uploadButton.disabled = true;
  uploadButton.textContent = t("uploading");
  toastStatus.textContent = t("uploadingToAssets");
  debugUploadLog(traceId, "用户点击保存到素材库", {
    imageUrl: describeDebugUrl(sourceUrl),
    requestId
  });

  let uploaded = false;
  let loginRequired = false;
  try {
    const preferredProject = await loadProjects({
      throwOnError: true
    });
    if (requestId !== uploadRequestId) return;
    toastStatus.textContent = t("uploadingToAssets");
    const response = await chrome.runtime.sendMessage({
      type: UPLOAD_IMAGE_MESSAGE,
      imageUrl: sourceUrl,
      sourceTitle: currentSourceTitle,
      sourcePageUrl: currentSourcePageUrl,
      projectId: preferredProject?.projectId,
      traceId
    });

    debugUploadLog(traceId, "收到 Service Worker 响应", {
      assetId: response?.assetId || null,
      ok: Boolean(response?.ok),
      responseTraceId: response?.traceId || null
    });

    if (requestId !== uploadRequestId) {
      debugUploadLog(traceId, "忽略已过期的上传响应", { requestId });
      return;
    }
    loginRequired = Boolean(response?.loginRequired);
    if (!response?.ok || !response.url || !response.assetId) {
      throw new Error(response?.error || t("uploadFailedRetry"));
    }

    uploaded = true;
    lastUploadSucceeded = true;
    currentSavedAssetIds = [response.assetId];
    selectedGroup = resolveSavedProject(response, preferredProject);
    pendingGroup = selectedGroup;
    toast.dataset.state = "success";
    toastTitle.textContent = t("saveSuccess");
    toastUrl.textContent = response.url;
    toastStatus.textContent = "";
    uploadButton.textContent = t("save");
    uploadButton.disabled = false;
    copyButton.textContent = t("copyAddress");
    updateGroupLabel();
    revealSaveResult();
    debugUploadLog(traceId, "Toast 已更新为素材地址", {
      resultUrl: describeDebugUrl(response.url)
    });
  } catch (error) {
    if (requestId !== uploadRequestId) {
      return;
    }
    if (!hasLiveExtensionContext() || isExtensionContextInvalidError(error)) {
      showExtensionReloadNotice();
      return;
    }

    debugUploadError(traceId, "保存到素材库失败", error);
    loginRequired = loginRequired || Boolean(error?.loginRequired);
    showSaveErrorToast(toUserMessage(error), { loginRequired });
  } finally {
    if (requestId === uploadRequestId) {
      uploading = false;
      uploadButton.disabled = false;
      if (loginRequired) {
        // 用户会切换到新标签页登录，保留 Toast，方便返回后直接重试。
        cancelToastHide();
      } else {
        scheduleToastHide(uploaded ? 5000 : 8000);
      }
    }
  }
}

function handlePointerOver(event) {
  if (!hoverFeatureEnabled) {
    return;
  }

  hoverPointer = { x: event.clientX, y: event.clientY };
  if (actionButton.contains(event.target)) {
    cancelScheduledHide();
    return;
  }

  const carousel = getRednoteCarousel(activeImage);
  if (carousel && isPointInsideRect(
    getRednoteCarouselViewport(carousel).getBoundingClientRect(), event.clientX, event.clientY
  )) {
    cancelScheduledHide();
    positionActionButton();
    return;
  }

  const pointerImage = findHoverImageAtPoint(event.clientX, event.clientY);
  const eventImage = pointerImage ? null : findImageFromEvent(event);
  const image = pointerImage || (
    eventImage && isPointInsideRect(
      getHoverEligibleRect(eventImage), event.clientX, event.clientY
    ) ? eventImage : null
  );

  if (!image) {
    if (activeImage) scheduleHide();
    if (activeImage && isImageBehindOpenModal(activeImage)) {
      hideActionButton();
    }
    return;
  }
  showHoverForImage(image);
}

function showHoverForImage(image) {
  if (isImageBehindOpenModal(image)) {
    hideActionButton();
    return;
  }
  if (!meetsHoverSizeRequirement(getHoverEligibleRect(image))) {
    hideActionButton();
    return;
  }

  cancelScheduledHide();
  activeImage = image;
  updateBatchSaveAction(image);
  lastContextTarget = {
    imageUrl: image.currentSrc || image.src,
    sourceTitle: getImageItemTitle(image),
    sourcePageUrl: getImageItemPageUrl(image),
    itemTagName: findItemFromTarget(image)?.tagName || null
  };
  actionButton.classList.add(ACTION_VISIBLE_CLASS);
  // 先显示再测量。按钮隐藏时 offsetWidth 为 0，会导致长文本仍按旧兜底宽度定位。
  positionActionButton();
  startPositionWatch();
}

function handleHoverPointerMove(event) {
  if (!hoverFeatureEnabled) return;
  hoverPointer = { x: event.clientX, y: event.clientY };
  if (!activeImage || actionButton.contains(event.target) || hoverPointerFrame !== null) return;

  hoverPointerFrame = requestAnimationFrame(() => {
    hoverPointerFrame = null;
    if (!hoverFeatureEnabled || !activeImage || !hoverPointer) return;
    const carousel = getRednoteCarousel(activeImage);
    if (carousel && isPointInsideRect(
      getRednoteCarouselViewport(carousel).getBoundingClientRect(), hoverPointer.x, hoverPointer.y
    )) {
      cancelScheduledHide();
      positionActionButton();
      return;
    }
    const image = findHoverImageAtPoint(hoverPointer.x, hoverPointer.y);
    if (image && image !== activeImage) {
      showHoverForImage(image);
    } else if (image) {
      cancelScheduledHide();
    } else if (activeImage) {
      scheduleHide();
    }
  });
}

function handleContextMenu(event) {
  if (!hoverFeatureEnabled) {
    lastContextTarget = null;
    return;
  }

  const image = findImageFromEvent(event);
  const item = findItemFromTarget(event.target);
  const itemImage =
    image ||
    Array.from(item?.querySelectorAll("img") || []).find((candidate) =>
      isEligibleHoverImage(candidate)
    );
  const imageUrl = itemImage?.currentSrc || itemImage?.src || null;

  lastContextTarget = imageUrl
    ? {
        imageUrl,
        sourceTitle: getImageItemTitle(itemImage),
        sourcePageUrl: getImageItemPageUrl(itemImage, event.target),
        itemTagName: item?.tagName || null
      }
    : null;
}

function findItemFromTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(
    [
      "article",
      "li",
      '[role="listitem"]',
      '[data-testid*="item" i]',
      '[data-testid*="card" i]',
      '[class*="item" i]',
      '[class*="card" i]'
    ].join(",")
  );
}

function getImageItemTitle(image) {
  if (!(image instanceof HTMLImageElement)) return "";

  const item =
    findCommerceListItem(image) ||
    findRepeatedCommerceVisualItem(image) ||
    findItemFromTarget(image) ||
    image.closest("a[href]");
  const titleNode = item?.matches(ITEM_TITLE_SELECTOR)
    ? item
    : item?.querySelector(ITEM_TITLE_SELECTOR);
  const candidates = [
    titleNode?.getAttribute("data-product-title"),
    titleNode?.getAttribute("data-item-title"),
    titleNode?.getAttribute("data-title"),
    titleNode?.getAttribute("title"),
    titleNode?.getAttribute("aria-label"),
    titleNode?.textContent,
    item?.getAttribute("data-product-title"),
    item?.getAttribute("data-item-title"),
    item?.getAttribute("data-title"),
    item?.getAttribute("title"),
    item?.getAttribute("aria-label"),
    image.getAttribute("alt"),
    image.getAttribute("title"),
    image.getAttribute("aria-label")
  ];

  for (const candidate of candidates) {
    const title = normalizeItemTitle(candidate);
    if (title) return title;
  }
  return "";
}

function getImageItemPageUrl(image, clickedTarget = image) {
  if (!(image instanceof HTMLImageElement)) return location.href;

  if (/(^|\.)instagram\.com$/i.test(location.hostname)) {
    const postUrl = getInstagramItemPostUrl(image);
    if (postUrl) return postUrl;
    // 首页帖子没有可读取的详情链接时，不能把头像或用户名链接当作来源。
    if (image.closest("article")) return location.href;
  }

  const item =
    findCommerceListItem(image) ||
    findRepeatedCommerceVisualItem(image) ||
    findItemFromTarget(image);
  const candidates = [
    item && findProductLink(item),
    clickedTarget instanceof Element
      ? clickedTarget.closest(PRODUCT_LINK_SELECTOR)
      : null,
    image.closest(PRODUCT_LINK_SELECTOR),
    item,
    item?.querySelector(PRODUCT_LINK_SELECTOR)
  ];

  for (const candidate of candidates) {
    const url = getNavigableItemUrl(candidate);
    if (url && url !== image.currentSrc && url !== image.src) return url;
  }
  return location.href;
}

function getInstagramItemPostUrl(image) {
  const postPath = /^\/(?:[^/]+\/)?p\/[a-z0-9_-]+\/?$/i;
  const article = image.closest("article");
  const links = [
    image.closest("a[href]"),
    ...(article?.querySelectorAll("a[href]") || [])
  ];
  for (const link of links) {
    const href = getNavigableItemUrl(link);
    if (!href) continue;
    const url = new URL(href);
    if (/(^|\.)instagram\.com$/i.test(url.hostname) &&
        postPath.test(url.pathname)) return url.href;
  }
  const dialog = article ? null : image.closest('[role="dialog"]');
  if (dialog) {
    const postUrls = new Set(Array.from(dialog.querySelectorAll("a[href]"), (link) => {
      const href = getNavigableItemUrl(link);
      if (!href) return null;
      const url = new URL(href);
      return /(^|\.)instagram\.com$/i.test(url.hostname) && postPath.test(url.pathname)
        ? `${url.origin}${url.pathname}` : null;
    }).filter(Boolean));
    if (postUrls.size === 1) return postUrls.values().next().value;
  }
  if (postPath.test(location.pathname)) return location.href;
  return null;
}

function getNavigableItemUrl(element) {
  if (!(element instanceof Element)) return null;

  for (const attribute of PRODUCT_LINK_URL_ATTRIBUTES) {
    const value = element.getAttribute(attribute)?.trim();
    if (!value || value.startsWith("#")) continue;
    try {
      const url = new URL(value, location.href);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
    } catch {
      // 忽略无效或非网页链接，继续寻找当前 item 的其他跳转地址。
    }
  }
  return null;
}

function normalizeItemTitle(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 500)
    : "";
}

function handleContextMenuResult(message) {
  // 进度消息可能先于 content script 就绪而丢失；结果消息本身足以展示最终状态。
  // 仅在页面仍跟踪另一条保存任务时，才丢弃不匹配的旧结果。
  if (currentContextMenuTraceId && message.traceId !== currentContextMenuTraceId) return;
  const sourceUrl = message.imageUrl || currentSourceUrl || "";
  showToast(sourceUrl, message.sourceTitle, message.sourcePageUrl, {
    mode: "hidden"
  });
  if (message.ok && message.url) {
    lastUploadSucceeded = true;
    currentSavedAssetIds = message.assetId ? [message.assetId] : [];
    selectedGroup = resolveSavedProject(message, null);
    pendingGroup = selectedGroup;
    toast.dataset.state = "success";
    toastTitle.textContent = t("saveSuccess");
    toastUrl.textContent = message.url;
    toastStatus.textContent = "";
    uploadButton.textContent = t("save");
    uploadButton.disabled = false;
    updateGroupLabel();
    revealSaveResult();
    scheduleToastHide(5000);
    return;
  }

  showSaveErrorToast(message.error || t("saveFailedSimple"), {
    loginRequired: Boolean(message.loginRequired)
  });
}

function handlePointerOut(event) {
  if (!activeImage) {
    return;
  }

  if (isImageBehindOpenModal(activeImage)) {
    hideActionButton();
    return;
  }

  if (
    event.relatedTarget === actionButton ||
    (event.relatedTarget instanceof Node &&
      actionButton.contains(event.relatedTarget))
  ) {
    return;
  }

  // 对于带蒙层的商品图片，pointerout 的 target 是蒙层而不是 img。
  // 根据离开事件发生时鼠标下方的元素重新判断，仍在同一张图片上就保持显示。
  hoverPointer = { x: event.clientX, y: event.clientY };
  const pointerImage = findHoverImageAtPoint(event.clientX, event.clientY);
  if (pointerImage === activeImage) {
    cancelScheduledHide();
    return;
  }

  const carousel = getRednoteCarousel(activeImage);
  const carouselViewport = carousel
    ? getRednoteCarouselViewport(carousel)
    : getInstagramCarouselViewport(activeImage);
  if (carouselViewport && isPointInsideRect(carouselViewport.getBoundingClientRect(), event.clientX, event.clientY)) {
    cancelScheduledHide();
    return;
  }

  scheduleHide();
}

function findImageFromEvent(event) {
  const path = event.composedPath();
  const imageInEventPath = path.find((node) => node instanceof HTMLImageElement);

  if (imageInEventPath) {
    return isEligibleHoverImage(imageInEventPath) ? imageInEventPath : null;
  }

  // 商品卡片经常在图片上方放置链接或蒙层。此时事件路径中没有 img，
  // 但 elementsFromPoint 可以继续找到鼠标坐标下方被覆盖的图片。
  const pointImage = findImageAtPoint(event.clientX, event.clientY);
  if (pointImage) return pointImage;

  // Amazon 等站点会给商品图设置 pointer-events:none，鼠标事件实际命中
  // 外层商品链接，elementsFromPoint 里也不会出现 img。此时只在鼠标坐标
  // 确实落入链接/卡片内某张合格图片的可视矩形时才兜底，避免悬停文字区
  // 也错误显示图片操作。
  const coveredImage = findCoveredImageFromTarget(
    event.target,
    event.clientX,
    event.clientY
  );
  if (coveredImage) return coveredImage;

  // Pinterest 的 Pin 常将图片放在 pointer-events:none 的蒙层下，
  // 事件路径和 elementsFromPoint 都可能拿不到 img，改从 Pin 容器兜底查找。
  if (isPinterestPage() && event.target instanceof Element) {
    const pin = event.target.closest('[data-test-id*="pin" i], [data-test-id*="Pin"], a[href*="/pin/"]');
    const image = pin?.querySelector("img");
    if (isEligibleHoverImage(image)) return image;
  }
  return null;
}

function findCoveredImageFromTarget(target, x, y) {
  if (!(target instanceof Element)) {
    return null;
  }

  const container = target.closest(
    [
      "a[href]",
      "article",
      "li",
      '[role="listitem"]',
      '[data-testid*="item" i]',
      '[data-testid*="card" i]'
    ].join(",")
  );
  if (!container) return null;

  return (
    Array.from(container.querySelectorAll("img")).find((image) => {
      const rect = image.getBoundingClientRect();
      return (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom &&
        isEligibleHoverImage(image)
      );
    }) || null
  );
}

function meetsHoverSizeRequirement(rect) {
  return (
    rect.width >= MIN_HOVER_IMAGE_SIZE &&
    rect.height >= MIN_HOVER_IMAGE_SIZE
  );
}

function isImageBehindOpenModal(image) {
  const modals = Array.from(
    document.querySelectorAll(OPEN_MODAL_SELECTOR)
  );

  // 国内小红书和 Rednote 的笔记详情弹窗都没有稳定的 dialog/aria-modal 标记。
  if (/(^|\.)(?:xiaohongshu|rednote)\.com$/i.test(location.hostname)) {
    const noteModal = document.getElementById("noteContainer");
    if (noteModal) modals.push(noteModal);
  }

  if (modals.some((modal) => {
    if (modal.contains(image) || !modal.isConnected) return false;
    if (modal.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(modal);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      modal.getClientRects().length > 0
    );
  })) return true;

  // 淘宝等站点的广告弹窗可能没有 dialog 标记；只拦截图片上方真正覆盖视口的浮层。
  return isImageBehindViewportOverlay(image);
}

function isViewportOverlay(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  if (
    !["fixed", "absolute"].includes(style.position) ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) return false;

  const rect = element.getBoundingClientRect();
  return (
    rect.left <= window.innerWidth * 0.1 &&
    rect.top <= window.innerHeight * 0.1 &&
    rect.right >= window.innerWidth * 0.9 &&
    rect.bottom >= window.innerHeight * 0.9
  );
}

function isImageBehindViewportOverlay(image) {
  if (typeof document.elementsFromPoint !== "function") return false;
  const rect = image.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return false;

  const stack = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2);
  const imageIndex = stack.findIndex((element) =>
    element === image || element.contains(image)
  );
  return stack.some((element, index) =>
    index < (imageIndex < 0 ? stack.length : imageIndex) &&
    !element.contains(image) &&
    isViewportOverlay(element)
  );
}

function isModalMutation(mutation) {
  if (mutation.type === "attributes") {
    const target = mutation.target;
    return (
      target instanceof Element &&
      (target === document.body ||
        target === document.documentElement ||
        target.matches(MODAL_CANDIDATE_SELECTOR) ||
        isViewportOverlay(target))
    );
  }

  return Array.from(mutation.addedNodes)
    .concat(Array.from(mutation.removedNodes))
    .some(
      (node) =>
        node instanceof Element &&
        (node.matches(MODAL_CANDIDATE_SELECTOR) ||
          Boolean(node.querySelector(MODAL_CANDIDATE_SELECTOR)) ||
          isViewportOverlay(node))
    );
}

function isEligibleHoverImage(image) {
  if (
    !(image instanceof HTMLImageElement) ||
    isVideoItemImage(image) ||
    !(image.currentSrc || image.src)
  ) {
    return false;
  }

  if (!isCommercePage()) {
    return true;
  }

  const sourceUrl = image.currentSrc || image.src;
  const now = Date.now();
  const cached = hoverEligibilityCache.get(image);
  if (
    cached?.sourceUrl === sourceUrl &&
    cached.expiresAt > now
  ) {
    return cached.eligible;
  }

  const eligible = Boolean(
    !isTaobaoDetailZoomCopy(image) && (
      getTaobaoProductGalleryImageUrls(image).length > 1 ||
      findCommerceListItem(image) ||
      findRepeatedCommerceVisualItem(image) ||
      // 商品大图不一定处于可识别的卡片内；保留广告、导航和横幅过滤。
      !isExcludedCommerceImage(image, null, null)
    )
  );
  hoverEligibilityCache.set(image, {
    eligible,
    sourceUrl,
    expiresAt: now + 1500
  });
  return eligible;
}

function isCommercePage() {
  if (imageCandidateFilter.isCommerceHost(location.hostname)) {
    return true;
  }

  const now = Date.now();
  if (customCommercePageDetectionExpiresAt > now) {
    return customCommercePageDetected;
  }

  customCommercePageDetected =
    document.querySelectorAll(
      '[itemtype*="schema.org/Product" i], [data-product-id], [data-testid*="product-card" i]'
    ).length > 1;
  customCommercePageDetectionExpiresAt = now + 2000;
  return customCommercePageDetected;
}

function findCommerceListItem(image) {
  const directLink = image.closest(PRODUCT_LINK_SELECTOR);
  const candidates = findCommerceCardCandidates(image);
  if (
    directLink &&
    getProductLinkUrl(directLink) &&
    !candidates.includes(directLink)
  ) {
    candidates.push(directLink);
  }

  for (const card of candidates) {
    const productLink = findProductLink(card);
    if (
      hasCommerceProductEvidence(card, productLink) &&
      !isExcludedCommerceImage(image, card, productLink) &&
      isPrimaryCommerceImage(image, card) &&
      hasRepeatedCommerceItems(card)
    ) {
      return card;
    }
  }

  return null;
}

/**
 * 一些电商首页或品牌馆不会输出 SKU、Product schema 或商品详情链接，
 * 但会把可操作的内容卡片组织成同级重复 item。此兜底仅接受尺寸相近、
 * 每个分支只有一张主图且链接指向商品详情的卡片；轮播、Hero、广告和导航
 * 仍排除。global.jd.com 的频道卡片是产品需求明确允许的唯一非商品链接例外。
 */
function findRepeatedCommerceVisualItem(image) {
  const imageSize = getImageDisplaySize(image);
  if (
    imageSize.width < 80 ||
    imageSize.height < 80 ||
    imageSize.width / imageSize.height >= 3.2 ||
    isExcludedCommerceImage(image, null, null, { allowCategoryLink: true })
  ) {
    return null;
  }

  let card = image.parentElement;
  for (let depth = 0; card && depth < 8; depth += 1) {
    if (
      card === document.body ||
      card === document.documentElement ||
      card.tagName === "MAIN"
    ) {
      break;
    }

    if (
      isRepeatedVisualCardCandidate(card, image, imageSize) &&
      countComparableVisualPeers(card, imageSize) > 1
    ) {
      return card;
    }
    card = card.parentElement;
  }

  return null;
}

function isRepeatedVisualCardCandidate(card, image, imageSize) {
  const clickableLink =
    card instanceof Element ? findClickableLink(card) : null;
  if (
    !(card instanceof Element) ||
    hasGenericVisualExcludedMetadata(card) ||
    !isAllowedRepeatedVisualLink(clickableLink)
  ) {
    return false;
  }

  const cardRect = card.getBoundingClientRect();
  const imageArea = imageSize.width * imageSize.height;
  const cardArea = (cardRect.width || imageSize.width) *
    (cardRect.height || imageSize.height);
  if (imageArea > 0 && cardArea > imageArea * 4) return false;

  const visualImages = getVisualCardImages(card);
  return visualImages.length === 1 && visualImages[0] === image;
}

function countComparableVisualPeers(card, imageSize) {
  const parent = card.parentElement;
  if (!parent || hasGenericVisualExcludedMetadata(parent)) return 0;

  let count = 0;
  for (const sibling of Array.from(parent.children).slice(0, 100)) {
    if (hasGenericVisualExcludedMetadata(sibling)) continue;
    const images = getVisualCardImages(sibling);
    if (
      images.length !== 1 ||
      !isAllowedRepeatedVisualLink(findClickableLink(sibling))
    ) {
      continue;
    }

    const peerSize = getImageDisplaySize(images[0]);
    if (areComparableVisualSizes(imageSize, peerSize)) {
      count += 1;
      if (count > 1) return count;
    }
  }
  return count;
}

function getVisualCardImages(container) {
  return Array.from(container.querySelectorAll("img"))
    .slice(0, 20)
    .filter((candidate) => {
      if (isVideoItemImage(candidate)) return false;
      const size = getImageDisplaySize(candidate);
      return (
        size.width >= 80 &&
        size.height >= 80 &&
        size.width / size.height < 3.2
      );
    });
}

function findClickableLink(container) {
  if (container.matches("a[href]")) return container;
  return container.querySelector("a[href]");
}

function isAllowedRepeatedVisualLink(link) {
  if (!(link instanceof Element)) return false;
  if (location.hostname.toLowerCase() === "global.jd.com") return true;
  return imageCandidateFilter.isProductHref(link.href, location.href);
}

function areComparableVisualSizes(left, right) {
  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  if (leftArea <= 0 || rightArea <= 0) return false;
  const areaRatio = rightArea / leftArea;
  const leftAspectRatio = left.width / left.height;
  const rightAspectRatio = right.width / right.height;
  return (
    areaRatio >= 0.45 &&
    areaRatio <= 2.2 &&
    Math.abs(leftAspectRatio - rightAspectRatio) <= 0.65
  );
}

function hasGenericVisualExcludedMetadata(element) {
  const metadata = [
    element.id,
    element.getAttribute("class"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-component-type"),
    element.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return (
    imageCandidateFilter.hasExcludedMetadata(metadata) ||
    GENERIC_VISUAL_EXCLUDED_METADATA_PATTERN.test(metadata)
  );
}

function findCommerceCardCandidates(image) {
  const candidates = [];
  let current = image.parentElement;

  for (let depth = 0; current && depth < 12; depth += 1) {
    if (
      (current.matches(COMMERCE_ITEM_SELECTOR) ||
        current.matches(GENERIC_ITEM_SELECTOR)) &&
      !current.matches(COMMERCE_LIST_SELECTOR)
    ) {
      candidates.push(current);
    }
    if (
      current === document.body ||
      current === document.documentElement
    ) {
      break;
    }
    current = current.parentElement;
  }

  return candidates;
}

function findProductLink(container) {
  if (!(container instanceof Element)) return null;
  if (container.matches(PRODUCT_LINK_SELECTOR) && getProductLinkUrl(container)) {
    return container;
  }

  return (
    Array.from(container.querySelectorAll(PRODUCT_LINK_SELECTOR))
      .slice(0, 30)
      .find((link) => getProductLinkUrl(link)) || null
  );
}

function getProductLinkUrl(element) {
  if (!(element instanceof Element)) return null;

  for (const attribute of PRODUCT_LINK_URL_ATTRIBUTES) {
    const value =
      attribute === "href" && "href" in element
        ? element.href
        : element.getAttribute(attribute);
    if (imageCandidateFilter.isProductHref(value, location.href)) {
      return value;
    }
  }

  return null;
}

function hasCommerceProductEvidence(card, productLink) {
  return Boolean(
    productLink ||
      card.matches(JD_PRODUCT_ITEM_SELECTOR) ||
      card.matches(
        [
          '[data-asin]:not([data-asin=""])',
          '[data-product-id]',
          '[data-item-id]',
          '[data-sku]',
          '[itemtype*="schema.org/Product" i]',
          '[data-component-type="s-search-result"]',
          '[data-testid*="product" i]',
          '[class*="product-" i]',
          '[class*="goods-" i]',
          '[class*="listing-" i]',
          '[class*="offer-" i]',
          ".gl-item"
        ].join(",")
      )
  );
}

function isExcludedCommerceImage(
  image,
  card,
  productLink,
  { allowCategoryLink = false } = {}
) {
  const resolvedCard =
    card || image.closest(COMMERCE_ITEM_SELECTOR) || image.closest(GENERIC_ITEM_SELECTOR);
  const directLink = image.closest(PRODUCT_LINK_SELECTOR);
  const contextNodes = [resolvedCard, directLink, image.parentElement].filter(Boolean);

  if (
    contextNodes.some((node) =>
      imageCandidateFilter.hasExcludedMetadata(
        node.id,
        node.getAttribute("class"),
        node.getAttribute("data-testid"),
        node.getAttribute("data-component-type"),
        node.getAttribute("aria-label")
      )
    )
  ) {
    return true;
  }

  const altText = `${image.alt || ""} ${image.title || ""}`;
  if (imageCandidateFilter.hasExcludedMetadata(altText)) return true;

  if (
    !allowCategoryLink &&
    directLink &&
    imageCandidateFilter.isCategoryHref(directLink.href, location.href) &&
    !imageCandidateFilter.isProductHref(directLink.href, location.href)
  ) {
    return true;
  }

  if (
    resolvedCard &&
    imageCandidateFilter.hasAdDisclosureText(
      resolvedCard.innerText || resolvedCard.textContent
    )
  ) {
    return true;
  }

  const { width, height } = getImageDisplaySize(image);
  return width > 0 && height > 0 && width / height >= 3.2;
}

function isPrimaryCommerceImage(image, card) {
  const size = getImageDisplaySize(image);
  if (size.width < 80 || size.height < 80) return false;

  const largestArea = Array.from(card.querySelectorAll("img")).reduce(
    (largest, candidate) => {
      const candidateSize = getImageDisplaySize(candidate);
      return Math.max(largest, candidateSize.width * candidateSize.height);
    },
    0
  );

  return largestArea === 0 || size.width * size.height >= largestArea * 0.65;
}

function getImageDisplaySize(image) {
  const rect = image.getBoundingClientRect();
  return {
    width: rect.width || image.width || image.naturalWidth || 0,
    height: rect.height || image.height || image.naturalHeight || 0
  };
}

function hasRepeatedCommerceItems(card) {
  let parent = card.parentElement;

  for (let depth = 0; parent && depth < 8; depth += 1) {
    if (
      parent === document.body ||
      parent === document.documentElement ||
      parent.tagName === "MAIN"
    ) {
      break;
    }

    const siblingCandidates = Array.from(parent.children)
      .slice(0, 100)
      .filter((child) => branchLooksLikeCommerceItem(child));
    if (siblingCandidates.length > 1) return true;

    if (
      parent.matches(COMMERCE_LIST_SELECTOR) &&
      countCommerceItems(parent) > 1
    ) {
      return true;
    }

    parent = parent.parentElement;
  }

  return false;
}

function branchLooksLikeCommerceItem(element) {
  if (!(element instanceof Element)) return false;
  const explicitItem = element.matches(COMMERCE_ITEM_SELECTOR)
    ? element
    : element.querySelector(COMMERCE_ITEM_SELECTOR);
  if (explicitItem && !hasExcludedCommerceMetadata(explicitItem)) return true;
  return (
    !hasExcludedCommerceMetadata(element) &&
    hasCommerceProductEvidence(element, findProductLink(element))
  );
}

function countCommerceItems(container) {
  let count = 0;
  for (const child of Array.from(container.children).slice(0, 100)) {
    if (branchLooksLikeCommerceItem(child)) count += 1;
    if (count > 1) break;
  }
  return count;
}

function hasExcludedCommerceMetadata(element) {
  return imageCandidateFilter.hasExcludedMetadata(
    element.id,
    element.getAttribute("class"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-component-type"),
    element.getAttribute("aria-label")
  );
}

function isPinterestPage() {
  return /(?:^|\.)pinterest\.[a-z.]+$/i.test(location.hostname);
}

function isPinterestPinDetailPage() {
  return isPinterestPage() && /^\/pin\/[^/]+\/?$/i.test(location.pathname);
}

function findImageAtPoint(x, y) {
  const image =
    document
      .elementsFromPoint(x, y)
      .find((element) => element instanceof HTMLImageElement) || null;

  return isEligibleHoverImage(image) ? image : null;
}

function findHoverImageAtPoint(x, y) {
  const elements = document.elementsFromPoint(x, y);
  if (elements[0] === actionButton || actionButton.contains(elements[0])) {
    return activeImage;
  }

  const images = elements.filter((element) => {
    if (
      !(element instanceof HTMLImageElement) ||
      !isEligibleHoverImage(element) ||
      isImageBehindOpenModal(element)
    ) {
      return false;
    }
    const rect = getHoverEligibleRect(element);
    return meetsHoverSizeRequirement(rect) && isPointInsideRect(rect, x, y);
  });
  // 多张图片叠在同一坐标时，优先选鼠标所在的较小 item，避免误绑到
  // 覆盖整个瀑布流的放大预览图；不按站点或固定卡片宽度限制。
  const cardImages = images.map((image) => {
    const item = findItemFromTarget(image);
    const rect = item?.getBoundingClientRect();
    return { image, rect };
  }).filter(({ rect }) => rect &&
    meetsHoverSizeRequirement(rect) && isPointInsideRect(rect, x, y));
  if (cardImages.length) {
    cardImages.sort((a, b) =>
      a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    return cardImages[0].image;
  }

  if (images.length) return images[0];

  // 有些站点把图片设为 pointer-events:none，需从鼠标下的卡片节点补找。
  for (const element of elements) {
    if (!(element instanceof Element)) continue;
    const item = element.closest(
      'a[href], article, li, [role="listitem"], [data-testid*="pin" i], [data-testid*="item" i], [data-testid*="card" i], [class*="pin" i], [class*="card" i], [class*="item" i]'
    );
    if (!item) continue;
    const rect = item.getBoundingClientRect();
    if (
      !meetsHoverSizeRequirement(rect) ||
      !isPointInsideRect(rect, x, y)
    ) continue;
    const image = Array.from(item.querySelectorAll("img")).find((candidate) => {
      if (!isEligibleHoverImage(candidate) || isImageBehindOpenModal(candidate)) return false;
      const anchor = getHoverEligibleRect(candidate);
      return meetsHoverSizeRequirement(anchor) && isPointInsideRect(anchor, x, y);
    });
    if (image) return image;
  }

  const coveredImage = findCoveredImageFromTarget(elements[0], x, y);
  const coveredRect = coveredImage && getHoverEligibleRect(coveredImage);
  return coveredImage &&
    !isImageBehindOpenModal(coveredImage) &&
    meetsHoverSizeRequirement(coveredRect) &&
    isPointInsideRect(coveredRect, x, y)
    ? coveredImage : null;
}

function isVideoItemImage(image) {
  if (!(image instanceof HTMLImageElement)) {
    return false;
  }

  // 一些站点会把缩略图和 video 放在同一个链接或 picture 容器中。
  const mediaContainer = image.closest("a[href], picture");
  if (mediaContainer?.querySelector(VIDEO_MARKER_SELECTOR)) {
    return true;
  }

  const card = image.closest(
    isXiaohongshuPage()
      ? XIAOHONGSHU_CARD_SELECTOR
      : 'article, [role="listitem"], li'
  );

  if (card?.querySelector(VIDEO_MARKER_SELECTOR)) {
    return true;
  }

  // 小红书的信息流视频通常仍使用 img 作为封面，仅通过右上角播放图标
  // 区分视频。该图标与封面是兄弟节点，因此需要在整张笔记卡片内判断。
  return Boolean(
    card &&
      isXiaohongshuPage() &&
      card.querySelector(XIAOHONGSHU_VIDEO_MARKER_SELECTOR)
  );
}

function isXiaohongshuPage() {
  return (
    location.hostname === "xiaohongshu.com" ||
    location.hostname.endsWith(".xiaohongshu.com")
  );
}

function intersectRects(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function getHoverAnchorRect(image) {
  const imageRect = image.getBoundingClientRect();
  let visibleRect = imageRect;
  let cardRect = null;
  let ancestor = image.parentElement;
  for (let depth = 0; ancestor && depth < 10; depth += 1) {
    if (ancestor === document.body || ancestor === document.documentElement) break;
    const rect = ancestor.getBoundingClientRect();
    const style = getComputedStyle(ancestor);
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
      visibleRect = intersectRects(visibleRect, {
        left: rect.left, right: rect.right,
        top: visibleRect.top, bottom: visibleRect.bottom
      });
    }
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
      visibleRect = intersectRects(visibleRect, {
        left: visibleRect.left, right: visibleRect.right,
        top: rect.top, bottom: rect.bottom
      });
    }

    // 图片放大或 object 裁剪时，按钮应跟随实际可见的 item 区域。
    if (
      ancestor.matches('a[href*="/pins/"], article, li, [class*="pin" i], [class*="card" i], [class*="item" i]') &&
      rect.width >= MIN_HOVER_IMAGE_SIZE &&
      rect.height >= MIN_HOVER_IMAGE_SIZE &&
      rect.width <= imageRect.width * 1.8 &&
      rect.height < imageRect.height - 16 &&
      (!cardRect || rect.width * rect.height < cardRect.width * cardRect.height)
    ) {
      cardRect = rect;
    }
    ancestor = ancestor.parentElement;
  }

  return cardRect ? intersectRects(visibleRect, cardRect) : visibleRect;
}

function getHoverEligibleRect(image) {
  const anchor = getHoverAnchorRect(image);
  return intersectRects(anchor, {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight
  });
}

function getRednoteCarousel(image) {
  const rednoteDetail = /(^|\.)rednote\.com$/i.test(location.hostname) &&
    /^\/discovery\/item\/[a-z0-9]+$/i.test(location.pathname);
  const xiaohongshu = /(^|\.)xiaohongshu\.com$/i.test(location.hostname);
  if (!rednoteDetail && !xiaohongshu) {
    return null;
  }
  return image?.closest("#noteContainer .media-container .xhs-slider-container") || null;
}

function getRednoteCarouselViewport(carousel) {
  return carousel.closest("#noteContainer .media-container") || carousel;
}

function isPointInsideRect(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function findVisibleRednoteCarouselImage(carousel) {
  return findVisibleCarouselImage(carousel, getRednoteCarouselViewport(carousel));
}

function findVisibleCarouselImage(carousel, viewport) {
  const frame = viewport.getBoundingClientRect();
  let visibleImage = null;
  let largestArea = 0;

  for (const image of carousel.querySelectorAll("img")) {
    if (!isEligibleHoverImage(image)) continue;
    const rect = image.getBoundingClientRect();
    if (!meetsHoverSizeRequirement(rect)) continue;
    const width = Math.max(0, Math.min(rect.right, frame.right) - Math.max(rect.left, frame.left));
    const height = Math.max(0, Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top));
    const area = width * height;
    if (area > largestArea) {
      largestArea = area;
      visibleImage = image;
    }
  }

  return visibleImage;
}

function positionActionButton() {
  const carousel = getRednoteCarousel(activeImage);
  const instagramViewport = carousel ? null : getInstagramCarouselViewport(activeImage);
  if (carousel || instagramViewport) {
    const visibleImage = carousel
      ? findVisibleRednoteCarouselImage(carousel)
      : findVisibleCarouselImage(instagramViewport, instagramViewport);
    if (visibleImage && visibleImage !== activeImage) {
      activeImage = visibleImage;
      updateBatchSaveAction(visibleImage);
    }
  }

  if (
    !hoverFeatureEnabled ||
    !activeImage?.isConnected ||
    !isEligibleHoverImage(activeImage) ||
    isImageBehindOpenModal(activeImage)
  ) {
    hideActionButton();
    return;
  }

  // 轮播轨道会横向移动；按钮固定到稳定的媒体视口。
  const imageRect = carousel
    ? getRednoteCarouselViewport(carousel).getBoundingClientRect()
    : instagramViewport
      ? instagramViewport.getBoundingClientRect()
      : getHoverAnchorRect(activeImage);
  const isOutsideViewport =
    imageRect.bottom <= 0 ||
    imageRect.right <= 0 ||
    imageRect.top >= window.innerHeight ||
    imageRect.left >= window.innerWidth;

  if (isOutsideViewport || !meetsHoverSizeRequirement(imageRect)) {
    hideActionButton();
    return;
  }

  const gap = 8;
  const buttonHeight = actionButton.offsetHeight || 28;
  const visibleLeft = Math.max(imageRect.left, 0);
  const visibleTop = Math.max(imageRect.top, 0);
  const visibleRight = Math.min(imageRect.right, window.innerWidth);
  const visibleBottom = Math.min(imageRect.bottom, window.innerHeight);
  const visibleWidth = visibleRight - visibleLeft;
  const visibleHeight = visibleBottom - visibleTop;
  if (!meetsHoverSizeRequirement({ width: visibleWidth, height: visibleHeight })) {
    hideActionButton();
    return;
  }
  const horizontalGap = Math.min(gap, Math.max(2, (visibleWidth - 36) / 2));
  const verticalGap = Math.min(gap, Math.max(2, (visibleHeight - buttonHeight) / 2));
  const availableWidth = Math.floor(visibleWidth - horizontalGap * 2);

  if (availableWidth < 32 || visibleHeight < buttonHeight + 4) {
    hideActionButton();
    return;
  }

  // 固定定位元素不受图片父级 overflow 裁切，因此显式限制按钮宽度。
  // 图片位于视口边缘时仍限制按钮宽度，避免溢出可见区域。
  actionButton.style.setProperty(
    "max-width",
    `${availableWidth}px`,
    "important"
  );
  const buttonWidth = Math.min(
    actionButton.offsetWidth || availableWidth,
    availableWidth
  );

  // CSS 使用了 !important 来避免被宿主网页覆盖，因此动态坐标也要使用
  // important 优先级，否则 all: initial 会把 left/top 重置为 auto。
  actionButton.style.setProperty(
    "left",
    `${Math.max(
      visibleLeft + horizontalGap,
      visibleRight - buttonWidth - horizontalGap
    )}px`,
    "important"
  );
  actionButton.style.setProperty(
    "top",
    `${Math.max(
      visibleTop + verticalGap,
      visibleBottom - buttonHeight - verticalGap
    )}px`,
    "important"
  );
}

function schedulePositionUpdate() {
  if (!activeImage || positionFrame !== null) {
    return;
  }

  positionFrame = requestAnimationFrame(() => {
    positionFrame = null;
    positionActionButton();
  });
}

function getImagePosition(image) {
  const carousel = getRednoteCarousel(image);
  const rect = carousel
    ? getRednoteCarouselViewport(carousel).getBoundingClientRect()
    : getInstagramCarouselViewport(image)
      ? image.getBoundingClientRect()
      : getHoverAnchorRect(image);
  const { left, top, right, bottom } = rect;
  return { left, top, right, bottom };
}

function hasImagePositionChanged(previous, next) {
  return (
    previous.left !== next.left ||
    previous.top !== next.top ||
    previous.right !== next.right ||
    previous.bottom !== next.bottom
  );
}

function startPositionWatch() {
  if (!activeImage || positionWatchTimer !== null) return;

  watchedImage = activeImage;
  watchedImageRect = getImagePosition(activeImage);
  // 瀑布流图片懒加载后可能只改变位置，不触发 scroll/resize，也不会改变图片本身的尺寸。
  // 仅在按钮显示期间检查坐标，避免按钮停留在图片旧位置。
  positionWatchTimer = window.setInterval(() => {
    if (!activeImage?.isConnected) {
      const replacement = hoverPointer &&
        findHoverImageAtPoint(hoverPointer.x, hoverPointer.y);
      if (replacement) showHoverForImage(replacement);
      else hideActionButton();
      return;
    }

    const carousel = getRednoteCarousel(activeImage);
    const pointerInsideCarousel = carousel && hoverPointer && isPointInsideRect(
      getRednoteCarouselViewport(carousel).getBoundingClientRect(), hoverPointer.x, hoverPointer.y
    );
    if (hoverPointer && !pointerInsideCarousel) {
      const pointerImage = findHoverImageAtPoint(hoverPointer.x, hoverPointer.y);
      if (!pointerImage) {
        if (hideTimer === null) scheduleHide();
        return;
      }
      if (pointerImage !== activeImage) {
        showHoverForImage(pointerImage);
      }
    }

    const nextRect = getImagePosition(activeImage);
    const instagramViewport = carousel ? null : getInstagramCarouselViewport(activeImage);
    const visibleCarouselImage = carousel
      ? findVisibleRednoteCarouselImage(carousel)
      : instagramViewport && findVisibleCarouselImage(instagramViewport, instagramViewport);
    if (
      activeImage !== watchedImage ||
      hasImagePositionChanged(watchedImageRect, nextRect) ||
      (visibleCarouselImage && visibleCarouselImage !== activeImage)
    ) {
      positionActionButton();
      if (activeImage) {
        watchedImage = activeImage;
        watchedImageRect = getImagePosition(activeImage);
      }
    }
  }, 100);
}

function stopPositionWatch() {
  if (positionWatchTimer !== null) {
    window.clearInterval(positionWatchTimer);
    positionWatchTimer = null;
  }
  watchedImage = null;
  watchedImageRect = null;
}

function scheduleHide() {
  cancelScheduledHide();
  hideTimer = window.setTimeout(hideActionButton, 100);
}

function cancelScheduledHide() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function hideActionButton() {
  cancelScheduledHide();
  stopPositionWatch();
  actionButton.classList.remove(ACTION_VISIBLE_CLASS);
  collapseActionMenu();
  activeImage = null;
}

function collapseActionMenu() {
  setActionMenuExpanded(false);
}

function setActionMenuExpanded(expanded) {
  actionButton.classList.toggle(ACTION_EXPANDED_CLASS, expanded);
  actionMenu.inert = !expanded;
  actionToggle.setAttribute("aria-expanded", String(expanded));
  actionToggle.setAttribute(
    "aria-label",
    expanded ? t("collapseMoreActions") : t("expandMoreActions")
  );
}

function showToast(imageUrl, sourceTitle = "", sourcePageUrl = "", { mode = "result" } = {}) {
  hideBatchBackdrop();
  hideSingleSaveProgress();
  currentContextMenuTraceId = null;
  uploadRequestId += 1;
  uploading = false;
  lastUploadSucceeded = false;
  selectedGroup = null;
  pendingGroup = null;
  savingGroup = false;
  cancelToastHide();
  currentSourceUrl = imageUrl;
  currentSourceTitle = normalizeItemTitle(sourceTitle);
  currentSourcePageUrl = sourcePageUrl || location.href;
  currentSavedAssetIds = [];
  toast.dataset.state = "loading";
  toast.classList.remove(
    "huojue-toast--batch",
    "huojue-toast--batch-success",
    TOAST_SAVE_ERROR_CLASS
  );
  toast.setAttribute("role", "region");
  toast.setAttribute("aria-label", t("saveResult"));
  delete toast.dataset.batchView;
  batchPanel.hidden = true;
  batchProgressPanel.hidden = true;
  batchSaving = false;
  currentBatchItems = [];
  selectedBatchUrls = new Set();
  batchUploadedAssets = [];
  batchGrid.replaceChildren();
  setGroupPanelExpanded(false);
  groupCreateRow.hidden = true;
  groupCreateInput.value = "";
  toastThumbnail.style.backgroundImage = imageUrl ? `url("${String(imageUrl).replaceAll('"', '%22')}")` : "none";
  toastDestinationLabel.textContent = t("savedTo");
  toastTitle.textContent = t("saving");
  toastStatus.textContent = "";
  toastUrl.textContent = "";
  copyButton.textContent = t("copyAddress");
  uploadButton.textContent = t("save");
  uploadButton.disabled = false;
  if (mode === "progress") {
    showSingleSaveProgress();
  } else if (mode === "result") {
    revealToast();
  }
  updateGroupLabel();
  if (mode === "result") scheduleToastHide(8000);
}

function renderGroupList() {
  const previousScrollTop = groupList.scrollTop;
  groupList.replaceChildren();
  const groups = projects;
  if (groups.length === 0 && groupCreateRow.hidden) {
    const empty = document.createElement("span");
    empty.className = "huojue-toast__group-empty";
    empty.textContent = t("noFolders");
    groupList.append(empty);
  }
  for (const group of groups) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "huojue-toast__group-item";
    button.setAttribute(
      "aria-pressed",
      String(pendingGroup?.projectId === group.projectId)
    );
    const groupFolderIcon = createGroupFolderIcon();
    const label = document.createElement("span");
    label.className = "huojue-toast__group-name";
    label.textContent = group.name;
    const radio = createToastIcon(
      pendingGroup?.projectId === group.projectId
        ? "toast-radio-selected.svg"
        : "toast-radio.svg"
    );
    button.append(groupFolderIcon, label, radio);
    button.addEventListener("click", () => {
      pendingGroup = group;
      groupCreateRow.hidden = true;
      groupCreateInput.value = "";
      renderGroupList();
    });
    groupList.append(button);
  }
  groupList.append(groupCreateRow);
  groupList.scrollTop = previousScrollTop;
}

function updateGroupLabel() {
  groupTriggerLabel.textContent =
    selectedGroup?.name || pendingGroup?.name || t("uncategorized");
}

function resolveSavedProject(response, requestedProject) {
  const projectId = response?.projectId || requestedProject?.projectId;
  if (!projectId) return null;
  const name =
    response?.projectName ||
    (requestedProject?.projectId === projectId
      ? requestedProject.name
      : null);
  return name ? { projectId, name } : null;
}

function setGroupPanelExpanded(expanded) {
  if (!expanded && !groupCreateRow.hidden) {
    groupCreateRow.hidden = true;
    groupCreateInput.value = "";
    pendingGroup = selectedGroup;
    updateGroupLabel();
  }
  groupPanel.hidden = !expanded;
  toastSeparator.hidden = !expanded;
  toastActions.hidden = !expanded;
  groupTrigger.setAttribute("aria-expanded", String(expanded));
  if (expanded) {
    cancelToastHide();
    renderGroupList();
  } else if (lastUploadSucceeded) {
    scheduleToastHide(5000);
  }
}

async function loadProjects({ throwOnError = false } = {}) {
  const requestId = uploadRequestId;
  if (projectsLoading && projectsLoadRequestId === requestId) {
    return pendingGroup;
  }
  projectsLoading = true;
  projectsLoadRequestId = requestId;
  try {
    const response = await chrome.runtime.sendMessage({
      type: GET_PROJECTS_MESSAGE,
      traceId: createUploadTraceId()
    });
    if (!response?.ok || !Array.isArray(response.projects)) {
      const error = new Error(response?.error || t("saveFolderFailed"));
      error.loginRequired = Boolean(response?.loginRequired);
      throw error;
    }
    if (requestId !== uploadRequestId) return;
    projects = response.projects.filter(
      (project) => project?.projectId && project?.name
    );
    const rememberedProject = response.selectedProject?.projectId
      ? projects.find(
          (project) =>
            project.projectId === response.selectedProject.projectId
        ) || null
      : null;
    if (!selectedGroup && !pendingGroup && groupCreateRow.hidden) {
      pendingGroup = rememberedProject;
    }
    updateGroupLabel();
    toastStatus.textContent = "";
    return rememberedProject;
  } catch (error) {
    if (requestId !== uploadRequestId) return;
    if (!groupPanel.hidden) {
      toastStatus.textContent = toUserMessage(error);
    }
    if (DEBUG_LOG_ENABLED) console.warn("[HuojueCapture][groups] 查询分组失败", error);
    if (throwOnError) throw error;
    return null;
  } finally {
    if (projectsLoadRequestId === requestId) {
      projectsLoading = false;
      projectsLoadRequestId = null;
    }
    if (requestId === uploadRequestId && !groupPanel.hidden) {
      renderGroupList();
    }
  }
}

async function saveSelectedGroup() {
  if (savingGroup || !lastUploadSucceeded) return;
  const saveRequestId = uploadRequestId;
  const name = groupCreateRow.hidden ? "" : groupCreateInput.value.trim();
  if (!groupCreateRow.hidden && !name) {
    groupCreateInput.focus();
    return;
  }
  if (!name && !pendingGroup) {
    setGroupPanelExpanded(false);
    return;
  }
  savingGroup = true;
  uploadButton.disabled = true;
  uploadButton.textContent = t("savingEllipsis");
  toastStatus.textContent = "";
  try {
    let project = pendingGroup;
    if (name) {
      const created = await chrome.runtime.sendMessage({
        type: CREATE_PROJECT_MESSAGE,
        name,
        traceId: createUploadTraceId()
      });
      if (!created?.ok || !created.project?.projectId) {
        throw new Error(created?.error || t("createFolderFailed"));
      }
      if (saveRequestId !== uploadRequestId) return;
      project = created.project;
      projects = [
        project,
        ...projects.filter(
          (item) => item.projectId !== project.projectId
        )
      ];
      pendingGroup = project;
      groupCreateRow.hidden = true;
      groupCreateInput.value = "";
    }
    if (!project?.projectId || currentSavedAssetIds.length === 0) {
      throw new Error(t("saveFolderFailed"));
    }
    const moved = await chrome.runtime.sendMessage({
      type: MOVE_ASSETS_MESSAGE,
      assetIds: currentSavedAssetIds,
      projectId: project.projectId,
      projectName: project.name,
      traceId: createUploadTraceId()
    });
    if (!moved?.ok) {
      throw new Error(moved?.error || t("saveFolderFailed"));
    }
    if (saveRequestId !== uploadRequestId) return;
    selectedGroup = project;
    updateGroupLabel();
    setGroupPanelExpanded(false);
    toastStatus.textContent = "";
  } catch (error) {
    if (saveRequestId === uploadRequestId) {
      toastStatus.textContent = toUserMessage(error);
      renderGroupList();
    }
  } finally {
    if (saveRequestId === uploadRequestId) {
      savingGroup = false;
      uploadButton.disabled = false;
      uploadButton.textContent = t("save");
    }
  }
}

function scheduleToastHide(delay) {
  cancelToastHide();
  if (toastHovered || uploading || batchSaving) {
    return;
  }
  toastTimer = window.setTimeout(() => {
    if (toastHovered || uploading || batchSaving) {
      toastTimer = null;
      return;
    }
    toast.classList.remove(TOAST_VISIBLE_CLASS);
    toast.remove();
    hideBatchBackdrop();
    toastTimer = null;
  }, delay);
}

function cancelToastHide() {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 非安全页面可能无法使用 Clipboard API，继续使用兼容方案。
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.setProperty("position", "fixed", "important");
  textArea.style.setProperty("left", "-9999px", "important");
  textArea.style.setProperty("opacity", "0", "important");
  document.documentElement.append(textArea);
  textArea.select();

  const copied = document.execCommand("copy");
  textArea.remove();

  if (!copied) {
    throw new Error(t("copyAddressFailed"));
  }
}

function toUserMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return t("uploadFailedRetry");
}

function isNetworkFetchError(message) {
  return (
    typeof message === "string" &&
    /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(
      message.trim()
    )
  );
}

function createUploadTraceId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function debugUploadLog(traceId, event, details) {
  if (!DEBUG_LOG_ENABLED) return;
  console.info(`[HuojueCapture][${traceId}][content] ${event}`, details);
}

function debugUploadError(traceId, event, error) {
  if (!DEBUG_LOG_ENABLED) return;
  console.error(`[HuojueCapture][${traceId}][content] ${event}`, {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) }
  });
}

function describeDebugUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") {
      return `data:${String(value).slice(5, 40).split(/[;,]/, 1)[0] || "unknown"}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

async function initializeSiteHoverSetting() {
  try {
    const stored = await chrome.storage.local.get(DISABLED_HOSTS_STORAGE_KEY);
    applySiteHoverSetting(stored[DISABLED_HOSTS_STORAGE_KEY]);
  } catch (error) {
    if (DEBUG_LOG_ENABLED) console.warn("[HuojueCapture][site-settings] 读取站点开关失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    applySiteHoverSetting(null);
  }
}

function applySiteHoverSetting(value) {
  const disabledHosts = normalizeDisabledHosts(value);
  hoverFeatureEnabled =
    !isBlockedExtensionHost(location.hostname) &&
    !disabledHosts[location.hostname.toLowerCase()];

  for (const element of [actionButton, toast, saveProgressToast, batchBackdrop]) {
    if (hoverFeatureEnabled) {
      element.style.removeProperty("display");
    } else {
      element.style.setProperty("display", "none", "important");
    }
  }

  if (!hoverFeatureEnabled) {
    hideActionButton();
    cancelToastHide();
    toast.classList.remove(TOAST_VISIBLE_CLASS);
    toast.remove();
    hideSingleSaveProgress();
    hideBatchBackdrop();
    toastHovered = false;
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

function isBlockedExtensionHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return BLOCKED_EXTENSION_HOSTS.some(
    (blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`)
  );
}

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}
