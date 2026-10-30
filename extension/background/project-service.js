import { createTraceId, debugLog, debugWarn } from "./debug-log.js";
import { requestJson } from "./api-client.js";
import { ACTIVE_ENVIRONMENT } from "./environment.js";

/** 与前端 `lib/constants.ts` 的 DEFAULT_PROJECT_NAME 一致：无项目时自动建一个 */
const DEFAULT_PROJECT_NAME = "默认项目";
const PROJECTS_PATH = "/projects";
const MOVE_ASSETS_PATH = "/assets/move";
const RECENT_PROJECT_STORAGE_KEY = `huojueRecentProject:${ACTIVE_ENVIRONMENT}`;
const MAX_USER_PREFERENCES = 10;

/**
 * 查询当前用户的全部项目（= 采集图的分组）。
 *
 * 后端 `GET /projects` 返回数组，但素材库等接口是 `{items,total}` 形状，
 * 两种都接住 —— 少判一种会在某次契约调整后静默变成「没有分组」。
 */
export async function listProjects({ token, traceId: providedTraceId } = {}) {
  const traceId = createTraceId(providedTraceId);
  debugLog("project", traceId, "开始查询项目列表");

  const { data } = await requestJson(PROJECTS_PATH, { token, traceId, scope: "project" });
  const raw = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const projects = raw.map(normalizeProject).filter(Boolean);

  debugLog("project", traceId, "项目列表查询完成", { projectCount: projects.length });
  return projects;
}

/** 新建项目（采集时可当场建一个新分组） */
export async function createProject({ name } = {}, { token, traceId: providedTraceId } = {}) {
  const traceId = createTraceId(providedTraceId);
  const normalizedName = normalizeProjectName(name);

  const { data } = await requestJson(PROJECTS_PATH, {
    method: "POST",
    body: { name: normalizedName },
    token,
    traceId,
    scope: "project"
  });
  const project = normalizeProject(data);
  if (!project) {
    throw new Error("新建分组接口返回格式无效。");
  }

  debugLog("project", traceId, "项目创建完成", { projectId: project.projectId });
  return project;
}

/**
 * 决定这次采集落到哪个分组。
 *
 * 顺序：该用户上次用的分组（仍在列表里）→ 列表第一个 → 自动新建默认分组。
 * 与前端 `useProject.ensureProject()` 的「第一个项目」口径一致，
 * 避免同一个人在网页和扩展里看到两张不同的分组归属。
 */
export async function resolveCaptureProject(
  { userId, token, traceId: providedTraceId } = {}
) {
  const traceId = createTraceId(providedTraceId);
  const projects = await listProjects({ token, traceId });

  if (projects.length === 0) {
    const created = await createProject({ name: DEFAULT_PROJECT_NAME }, { token, traceId });
    await setRecentProject(userId, created);
    debugLog("project", traceId, "无项目，已自动创建默认分组", {
      projectId: created.projectId
    });
    return created;
  }

  const recent = await getRecentProject(userId, projects);
  const project = recent || projects[0];
  await setRecentProject(userId, project);
  return project;
}

/**
 * 批量把已保存的素材移动到另一个分组。
 *
 * 后端 `PATCH /assets/move` 只改 `Asset.projectId`，不动生成任务的历史归属。
 * `missing` 里的 id 是「不属于当前用户或已被删除」的，调用方提示即可，不必逐条报错。
 */
export async function moveAssetsToProject(
  { assetIds, projectId } = {},
  { token, traceId: providedTraceId } = {}
) {
  const traceId = createTraceId(providedTraceId);
  const ids = normalizeAssetIds(assetIds);
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    throw new Error("目标分组 ID 格式无效。");
  }

  debugLog("project", traceId, "开始移动采集素材", {
    assetCount: ids.length,
    projectId: normalizedProjectId
  });
  const { data } = await requestJson(MOVE_ASSETS_PATH, {
    method: "PATCH",
    body: { ids, projectId: normalizedProjectId },
    token,
    traceId,
    scope: "project"
  });
  const result = {
    moved: Number.isFinite(data?.moved) ? data.moved : ids.length,
    missing: Array.isArray(data?.missing) ? data.missing : [],
    projectId: normalizeProjectId(data?.projectId) || normalizedProjectId
  };

  debugLog("project", traceId, "采集素材移动完成", {
    moved: result.moved,
    missingCount: result.missing.length
  });
  return result;
}

/** 退出登录 / 换账号时清掉「上次分组」，避免把图存进别人的分组名里 */
export async function clearRecentProjects() {
  await chrome.storage.local.remove(RECENT_PROJECT_STORAGE_KEY);
}

async function getRecentProject(userId, projects) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  const preferences = await readPreferences();
  const stored = preferences[normalizedUserId];
  if (!stored) return null;

  const hit = projects.find((project) => project.projectId === stored.projectId);
  if (hit) return hit;

  // 分组已被删除：顺手清掉这条旧偏好，别让下次再查一遍
  delete preferences[normalizedUserId];
  await writePreferences(preferences);
  return null;
}

async function setRecentProject(userId, project) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || !project?.projectId) return;

  const preferences = await readPreferences();
  preferences[normalizedUserId] = {
    projectId: project.projectId,
    name: project.name,
    updatedAt: Date.now()
  };
  const limited = Object.fromEntries(
    Object.entries(preferences)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_USER_PREFERENCES)
  );
  await writePreferences(limited);
}

async function readPreferences() {
  const stored = await chrome.storage.local.get(RECENT_PROJECT_STORAGE_KEY);
  const value = stored[RECENT_PROJECT_STORAGE_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const preferences = {};
  for (const [userId, project] of Object.entries(value)) {
    const normalizedUserId = normalizeUserId(userId);
    const projectId = normalizeProjectId(project?.projectId);
    if (!normalizedUserId || !projectId) continue;
    preferences[normalizedUserId] = {
      projectId,
      name: normalizeOptionalString(project?.name),
      updatedAt: Number.isFinite(project?.updatedAt) ? project.updatedAt : 0
    };
  }
  return preferences;
}

async function writePreferences(preferences) {
  if (Object.keys(preferences).length === 0) {
    await chrome.storage.local.remove(RECENT_PROJECT_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [RECENT_PROJECT_STORAGE_KEY]: preferences });
}

function normalizeProject(value) {
  const projectId = normalizeProjectId(value?.id ?? value?.projectId);
  const name = normalizeOptionalString(value?.name);
  return projectId && name ? { projectId, name } : null;
}

function normalizeProjectName(value) {
  const name = normalizeOptionalString(value);
  if (!name) throw new Error("分组名称不能为空。");
  if (name.length > 128) throw new Error("分组名称不能超过 128 个字符。");
  return name;
}

function normalizeProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.trim())
    ? value.trim()
    : null;
}

function normalizeAssetIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("至少需要一条待移动的素材。");
  }
  const ids = value.map((id) => (typeof id === "string" ? id.trim() : ""));
  if (ids.some((id) => !id || id.length > 64)) {
    throw new Error("素材 ID 格式无效。");
  }
  return [...new Set(ids)];
}

function normalizeUserId(value) {
  if (typeof value !== "string") return null;
  const userId = value.trim();
  return userId && userId.length <= 128 ? userId : null;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export { DEFAULT_PROJECT_NAME };
