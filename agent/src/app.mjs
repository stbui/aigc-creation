import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Codex } from '@openai/codex-sdk';
import {
  HttpError,
  readJsonBody,
  resolveWorkingDirectory,
  safeEqual,
  toDisplayPath,
  writeJson,
} from './lib.mjs';
import { SessionStore, appendUserMessage, upsertItem } from './sessions.mjs';
import { SessionStorage } from './storage.mjs';
import { isBenignCodexDiagnostic } from './diagnostics.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(thisDir, '../public');

const REASONING_EFFORTS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'persistent',
]);
const SANDBOX_MODES = new Set(['read-only', 'workspace-write']);
const WEB_SEARCH_MODES = new Set(['disabled', 'cached', 'live']);
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const MAX_PROMPT_LENGTH = 100_000;
// 100k 字符按 UTF-8 编码最多约 400KB，JSON 转义后仍有富余；沿用 256KB 默认上限会把
// 合法长度的中文提示词误判成 413。
const MAX_TURN_BODY_BYTES = 1024 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const STATIC_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['favicon.svg', 'image/svg+xml'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

export function createCodex(config) {
  const options = {};
  if (config.codexPathOverride) options.codexPathOverride = config.codexPathOverride;
  if (config.baseUrl) options.baseUrl = config.baseUrl;
  if (config.apiKey) options.apiKey = config.apiKey;
  return new Codex(options);
}

export function createAgentServer({ config, codex = createCodex(config) }) {
  const storage = createSessionStorage(config);
  const sessions = new SessionStore({
    maxSessions: config.maxSessions,
    initialSessions: storage?.load() || [],
    onChange: () => storage?.schedule(sessions.snapshot()),
  });

  if (!config.allowDangerFullAccess) {
    for (const session of sessions.list()) {
      if (session.settings.sandboxMode === 'danger-full-access') {
        session.settings = { ...session.settings, sandboxMode: 'workspace-write' };
      }
    }
  }

  const server = http.createServer((req, res) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(key, value);
    }

    handleRequest(req, res, { config, codex, sessions, storage }).catch((error) => {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      writeJson(res, status, {
        error: error instanceof HttpError ? error.message : '服务器内部错误',
        detail: error instanceof HttpError ? error.detail : undefined,
      });
      if (!(error instanceof HttpError)) {
        console.error('[codex-web] request failed:', error);
      }
    });
  });

  return { server, sessions, storage };
}

function createSessionStorage(config) {
  if (!config.dataDir) return null;
  try {
    return new SessionStorage(config.dataDir);
  } catch (error) {
    console.error('[codex-web] persistent history disabled:', error.message);
    return null;
  }
}

async function handleRequest(req, res, deps) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '请求路径无效');
  }

  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/health' && req.method === 'GET') {
      writeJson(res, 200, {
        ok: true,
        version: '0.1.0',
        sdk: '@openai/codex-sdk@0.164.0',
        authRequired: Boolean(deps.config.accessToken),
        historyPersisted: Boolean(deps.storage),
      });
      return;
    }
    if (!isAuthorized(req, url, deps.config)) {
      throw new HttpError(401, '未授权：请在设置中填写访问令牌');
    }
    await routeApi(req, res, url, pathname, deps);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed');
  }
  await serveStatic(req, res, pathname);
}

function isAuthorized(req, url, config) {
  if (!config.accessToken) return true;
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const queryToken = url.searchParams.get('token') || '';
  return safeEqual(bearer, config.accessToken) || safeEqual(queryToken, config.accessToken);
}

async function routeApi(req, res, url, pathname, deps) {
  const { config, codex, sessions } = deps;

  if (pathname === '/api/config' && req.method === 'GET') {
    writeJson(res, 200, {
      workspaceRoot: config.workspaceRoot,
      authRequired: Boolean(config.accessToken),
      allowDangerFullAccess: config.allowDangerFullAccess,
      defaults: {
        workingDirectory: '.',
        model: config.defaultModel,
        reasoningEffort: 'high',
        sandboxMode: 'workspace-write',
        webSearchMode: 'disabled',
        networkAccessEnabled: false,
      },
    });
    return;
  }

  if (pathname === '/api/sessions' && req.method === 'GET') {
    writeJson(res, 200, {
      sessions: sessions.list().map((session) => publicSession(session, config)),
    });
    return;
  }

  if (pathname === '/api/sessions' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const { settings, resolvedWorkingDirectory } = normalizeSettings(body.settings, config);
    const threadOptions = buildThreadOptions(settings, resolvedWorkingDirectory, config);

    let resumeThreadId = null;
    if (body.resumeThreadId !== undefined && body.resumeThreadId !== '') {
      if (typeof body.resumeThreadId !== 'string' || !THREAD_ID_PATTERN.test(body.resumeThreadId)) {
        throw new HttpError(400, '线程 ID 格式无效');
      }
      resumeThreadId = body.resumeThreadId;
    }

    const thread = resumeThreadId
      ? codex.resumeThread(resumeThreadId, threadOptions)
      : codex.startThread(threadOptions);

    const session = sessions.create({
      id: randomUUID(),
      title: typeof body.title === 'string' ? cleanTitle(body.title) : '新会话',
      codexThreadId: resumeThreadId,
      settings,
      resolvedWorkingDirectory,
      thread,
    });

    writeJson(res, 201, { session: publicSession(session, config) });
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([A-Za-z0-9-]+)(?:\/(turns|cancel))?$/);
  if (sessionMatch) {
    const session = sessions.get(sessionMatch[1]);
    if (!session) throw new HttpError(404, '会话不存在，服务可能已重启');
    const action = sessionMatch[2];

    if (!action && req.method === 'GET') {
      writeJson(res, 200, {
        session: publicSession(session, config),
        timeline: session.timeline,
      });
      return;
    }

    if (!action && req.method === 'DELETE') {
      sessions.delete(session.id);
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (action === 'cancel' && req.method === 'POST') {
      if (session.abortController) session.abortController.abort();
      writeJson(res, 200, { ok: true });
      return;
    }

    if (action === 'turns' && req.method === 'POST') {
      await runTurn(req, res, session, { config, codex });
      return;
    }
  }

  throw new HttpError(404, '接口不存在');
}

function normalizeSettings(raw, config) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const requestedWorkingDirectory =
    typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
      ? input.workingDirectory.trim()
      : '.';
  const resolvedWorkingDirectory = resolveWorkingDirectory(
    config.workspaceRoot,
    requestedWorkingDirectory,
  );

  const sandboxMode = input.sandboxMode || 'workspace-write';
  if (!SANDBOX_MODES.has(sandboxMode) && sandboxMode !== 'danger-full-access') {
    throw new HttpError(400, '沙箱模式无效');
  }
  if (sandboxMode === 'danger-full-access' && !config.allowDangerFullAccess) {
    throw new HttpError(403, '服务端未启用 danger-full-access');
  }

  const reasoningEffort = input.reasoningEffort || 'high';
  if (!REASONING_EFFORTS.has(reasoningEffort)) {
    throw new HttpError(400, '推理强度无效');
  }

  const webSearchMode = input.webSearchMode || 'disabled';
  if (!WEB_SEARCH_MODES.has(webSearchMode)) {
    throw new HttpError(400, '网页搜索模式无效');
  }

  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (model.length > 120) throw new HttpError(400, '模型名称过长');

  return {
    resolvedWorkingDirectory,
    settings: {
      workingDirectory: toDisplayPath(config.workspaceRoot, resolvedWorkingDirectory),
      model: model || config.defaultModel,
      reasoningEffort,
      sandboxMode,
      webSearchMode,
      networkAccessEnabled: Boolean(input.networkAccessEnabled),
    },
  };
}

function buildThreadOptions(settings, workingDirectory, config) {
  const options = {
    workingDirectory,
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    sandboxMode: settings.sandboxMode,
    modelReasoningEffort: settings.reasoningEffort,
    webSearchMode: settings.webSearchMode,
    networkAccessEnabled: settings.networkAccessEnabled,
  };
  if (settings.model) options.model = settings.model;
  if (settings.sandboxMode === 'danger-full-access' && !config.allowDangerFullAccess) {
    throw new HttpError(403, 'danger-full-access 未启用');
  }
  return options;
}

function publicSession(session, config) {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    codexThreadId: session.codexThreadId,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    settings: session.settings,
    workspaceRoot: config.workspaceRoot,
    usage: session.usage,
    lastError: session.lastError,
  };
}

function cleanTitle(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 60) || '新会话';
}

function titleFromPrompt(prompt) {
  return cleanTitle(prompt.split('\n').find((line) => line.trim()) || prompt);
}

async function runTurn(req, res, session, { config, codex }) {
  if (session.status === 'running') {
    throw new HttpError(409, '这个会话正在运行，请先停止当前任务');
  }

  // 先占住会话再读请求体：读 body 是异步的，两个并发请求会在等待期间同时通过上面的检查，
  // 导致同一个 Codex 线程被并发驱动（命令被重复执行、时间线交错）。占位后任何校验失败都要释放。
  session.status = 'running';

  let prompt;
  let messageId;
  let thread;
  try {
    const body = await readJsonBody(req, MAX_TURN_BODY_BYTES);
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) throw new HttpError(400, '请输入任务内容');
    if (prompt.length > MAX_PROMPT_LENGTH) throw new HttpError(413, '任务内容过长');
    messageId =
      typeof body.messageId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(body.messageId)
        ? body.messageId
        : undefined;
    thread = ensureSessionThread(session, codex, config);
  } catch (error) {
    session.status = 'idle';
    throw error;
  }

  if (session.title === '新会话') session.title = titleFromPrompt(prompt);
  appendUserMessage(session, prompt, messageId);
  session.lastError = null;
  session.usage = null;
  sessionsNotify(session);

  const controller = new AbortController();
  session.abortController = controller;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let finished = false;
  let outcome = 'completed';
  let failure = null;

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
  }, 15_000);
  heartbeat.unref?.();

  res.on('close', () => {
    if (!finished && !controller.signal.aborted) {
      controller.abort(new Error('client disconnected'));
    }
  });

  const send = (payload) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  send({ type: 'session', session: publicSession(session, config) });

  const turnItemPrefix = `turn-${randomUUID().slice(0, 8)}-`;

  try {
    const { events } = await thread.runStreamed(prompt, {
      signal: controller.signal,
    });

    for await (const event of events) {
      if (!event || typeof event.type !== 'string') continue;

      let outboundEvent = event;

      if (event.type === 'thread.started') {
        session.codexThreadId = event.thread_id;
      } else if (
        event.type === 'item.started' ||
        event.type === 'item.updated' ||
        event.type === 'item.completed'
      ) {
        if (isBenignCodexDiagnostic(event.item?.message)) {
          session.updatedAt = Date.now();
          continue;
        }
        if (event.item && typeof event.item.id === 'string' && event.item.id) {
          outboundEvent = {
            ...event,
            item: { ...event.item, id: `${turnItemPrefix}${event.item.id}` },
          };
        }
        upsertItem(session, outboundEvent.item);
      } else if (event.type === 'turn.completed') {
        session.usage = event.usage || null;
      } else if (event.type === 'turn.failed') {
        outcome = 'failed';
        session.lastError = event.error?.message || 'Codex 任务失败';
      } else if (event.type === 'error') {
        session.lastError = event.message || 'Codex 返回错误';
      }

      session.updatedAt = Date.now();
      if (
        event.type === 'thread.started' ||
        event.type === 'turn.completed' ||
        event.type === 'turn.failed' ||
        event.type === 'error'
      ) {
        sessionsNotify(session);
      }
      send({ type: 'event', event: outboundEvent });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      outcome = 'aborted';
    } else {
      outcome = 'failed';
      failure = describeError(error);
      session.lastError = failure.message;
      send({ type: 'error', ...failure });
    }
  } finally {
    finished = true;
    clearInterval(heartbeat);
    session.abortController = null;
    session.status = 'idle';
    session.updatedAt = Date.now();
    sessionsNotify(session);

    if (outcome === 'failed' && !failure) {
      failure = describeError(new Error(session.lastError || 'Codex 任务失败'));
      send({ type: 'error', ...failure });
    }

    if (outcome === 'failed' && failure) {
      const alreadyCaptured = session.timeline.some(
        (entry) =>
          entry.type === 'item' &&
          entry.item?.type === 'error' &&
          entry.item?.message === failure.message,
      );
      if (!alreadyCaptured) {
        session.timeline.push({
          type: 'notice',
          id: `notice-${randomUUID()}`,
          level: 'error',
          text: failure.message,
          createdAt: new Date().toISOString(),
        });
        sessionsNotify(session);
      }
    }

    send({
      type: outcome === 'aborted' ? 'aborted' : 'done',
      session: publicSession(session, config),
    });
    res.end();
  }
}

function ensureSessionThread(session, codex, config) {
  if (session.thread) return session.thread;

  const resolvedWorkingDirectory = resolveWorkingDirectory(
    config.workspaceRoot,
    session.settings.workingDirectory,
  );
  const settings = { ...session.settings };
  const options = buildThreadOptions(settings, resolvedWorkingDirectory, config);
  session.resolvedWorkingDirectory = resolvedWorkingDirectory;
  session.thread = session.codexThreadId
    ? codex.resumeThread(session.codexThreadId, options)
    : codex.startThread(options);
  return session.thread;
}

function sessionsNotify(session) {
  session.onChange?.();
}

function describeError(error) {
  const raw = error instanceof Error ? error.message : String(error || '未知错误');
  const message = raw.split('\n').slice(0, 8).join('\n').trim() || '未知错误';

  if (/not logged in|login|unauthorized|401|authentication|api key/i.test(raw)) {
    return {
      message,
      hint: '请先在终端执行 codex login，或为服务进程设置 CODEX_API_KEY。',
    };
  }
  if (/ENOENT|not found|spawn codex/i.test(raw)) {
    return {
      message,
      hint: '未找到 codex CLI。请安装 @openai/codex，或通过 CODEX_PATH 指定可执行文件。',
    };
  }
  if (/rate limit|429|quota/i.test(raw)) {
    return { message, hint: '请求过于频繁或额度不足，请稍后重试。' };
  }
  return { message };
}

async function serveStatic(req, res, pathname) {
  let fileName = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (fileName === 'favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }
  if (!STATIC_FILES.has(fileName)) {
    writeJson(res, 404, { error: '页面不存在' });
    return;
  }

  let data;
  try {
    data = await readFile(path.join(PUBLIC_DIR, fileName));
  } catch {
    writeJson(res, 404, { error: '页面不存在' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': STATIC_FILES.get(fileName),
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}
