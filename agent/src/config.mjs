import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '../..');
const defaultDataDir = path.resolve(thisDir, '../data');

function parsePort(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function parseBoolean(value) {
  if (value === undefined || value === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function loadConfig(env = process.env) {
  const workspaceRoot = path.resolve(env.AGENT_WORKSPACE_ROOT || repoRoot);

  let workspaceStat;
  try {
    workspaceStat = statSync(realpathSync(workspaceRoot));
  } catch {
    throw new Error(`AGENT_WORKSPACE_ROOT does not exist: ${workspaceRoot}`);
  }
  if (!workspaceStat.isDirectory()) {
    throw new Error(`AGENT_WORKSPACE_ROOT is not a directory: ${workspaceRoot}`);
  }

  return {
    host: env.HOST || '0.0.0.0',
    port: parsePort(env.PORT, 4310),
    workspaceRoot: realpathSync(workspaceRoot),
    accessToken: env.AGENT_ACCESS_TOKEN || '',
    allowDangerFullAccess: parseBoolean(env.AGENT_ALLOW_DANGER_FULL_ACCESS),
    maxSessions: parsePositiveInt(env.AGENT_MAX_SESSIONS, 25),
    // 0 表示关闭。Codex CLI 在上游断连时可能只吐出 turn.started 就不再有任何事件，
    // 没有这道空闲超时，会话会一直卡在 running，浏览器只能无限转圈。
    turnIdleTimeoutMs: parseNonNegativeInt(env.AGENT_TURN_IDLE_TIMEOUT_MS, 10 * 60 * 1000),
    dataDir: path.resolve(env.AGENT_DATA_DIR || defaultDataDir),
    defaultModel: env.AGENT_DEFAULT_MODEL || '',
    codexPathOverride: env.CODEX_PATH || '',
    baseUrl: env.CODEX_BASE_URL || env.OPENAI_BASE_URL || '',
    apiKey: env.CODEX_API_KEY || env.OPENAI_API_KEY || '',
  };
}
