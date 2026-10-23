import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { ApiError, unauthorized } from './errors.js';
import {
  corsHeaders,
  createLogger,
  baseUrlOf,
  pathOnly,
  readJson,
  readJsonOrMultipart,
  sendError,
  sendJson,
} from './http.js';
import { AssetStore } from './store.js';
import { handleChat } from './routes/chat.js';
import { handleImageGeneration, handleMinimaxImageGeneration } from './routes/images.js';
import { handleModel, handleModels } from './routes/models.js';
import { handleFile, handleHealth, handleIndex } from './routes/assets.js';
import {
  handleMinimaxFileRetrieve,
  handleMinimaxVideoCreate,
  handleMinimaxVideoQuery,
  handleOpenAiVideoContent,
  handleOpenAiVideoCreate,
  handleOpenAiVideoDelete,
  handleOpenAiVideoGet,
  handleOpenAiVideoList,
} from './routes/videos.js';

const JSON_LIMIT = 16 * 1024 * 1024;

/**
 * 创建（但不监听）网关服务。
 *
 * 导出 createApp 而不是直接起服务，是为了测试可以在随机端口上起一个
 * 实例，也方便将来嵌到别的脚本里。
 */
export function createApp(options = {}) {
  const cfg = options.config ?? loadConfig(options.env ?? process.env, options.overrides ?? {});
  const store =
    options.store ??
    new AssetStore({ ttlMs: cfg.fileTtlMs, maxBytes: cfg.maxStoreMb * 1024 * 1024 });
  const logger = options.logger ?? createLogger(cfg);
  const state = {
    /** @type {Map<string, any>} OpenAI 视频任务 */
    openaiVideos: new Map(),
    /** @type {Map<string, any>} MiniMax 视频任务 */
    minimaxTasks: new Map(),
  };

  const server = createServer((req, res) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.request(req.method ?? '-', pathOnly(req.url ?? '/'), res.statusCode, Date.now() - startedAt);
    });
    handleRequest({ req, res, cfg, store, state, logger }).catch((err) => {
      if (res.headersSent) {
        // SSE 等已经开写的响应：直接断开，避免在半截 JSON 后面再拼错误信封
        res.destroy();
        return;
      }
      sendError(req, res, err, logger);
    });
  });

  return {
    server,
    config: cfg,
    store,
    state,
    logger,
    listen(port = cfg.port, host = cfg.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const addr = server.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : port;
          const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
          resolve({ port: actualPort, host, url: `http://${displayHost}:${actualPort}` });
        });
      });
    },
    close() {
      store.dispose();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function handleRequest(ctx) {
  const { req, res, cfg } = ctx;
  const method = (req.method ?? 'GET').toUpperCase();
  const path = pathOnly(req.url ?? '/');
  const query = new URL(req.url ?? '/', 'http://mock.local').searchParams;
  const full = {
    ...ctx,
    method,
    path,
    query,
    cors: corsHeaders(req),
    base: baseUrlOf(req, cfg),
  };

  if (method === 'OPTIONS') {
    // 探活也走鉴权：令牌错时后台测试应显示「令牌被拒绝」，而不是绿勾。
    verifyAuth(req, cfg);
    /*
     * 只对真实存在的路径回 204。若对所有路径都回 204，
     * 后台渠道测试里「基址填错 / 协议选错」也会显示连通正常 ——
     * 那正是这个工具要帮人发现的问题，不能替它掩盖。
     */
    if (!isKnownPath(path)) {
      throw new ApiError(404, `未实现的路径: ${method} ${path}`, { code: 'not_found' });
    }
    res.writeHead(204, {
      ...full.cors,
      Allow: 'GET, POST, DELETE, OPTIONS',
      'Content-Length': '0',
    });
    res.end();
    return;
  }

  if (path === '/v1' || path.startsWith('/v1/')) verifyAuth(req, cfg);

  if (method === 'GET' && (path === '/' || path === '/index.json')) return handleIndex(full);
  if (method === 'GET' && path === '/health') return handleHealth(full);

  if (method === 'GET' && (path === '/v1/models' || path === '/models')) return handleModels(full);
  const modelMatch = /^\/v1\/models\/([^/]+)\/?$/.exec(path);
  if (modelMatch) {
    if (method !== 'GET') return methodNotAllowed(full, 'GET');
    return handleModel(full, decodeURIComponent(modelMatch[1]));
  }

  if (path === '/v1/chat/completions') {
    if (method !== 'POST') return methodNotAllowed(full, 'POST');
    full.body = await readJson(req, JSON_LIMIT);
    return handleChat(full);
  }

  if (path === '/v1/images/generations') {
    if (method !== 'POST') return methodNotAllowed(full, 'POST');
    full.body = await readJson(req, JSON_LIMIT);
    return handleImageGeneration(full);
  }

  if (path === '/v1/images/edits') {
    if (method !== 'POST') return methodNotAllowed(full, 'POST');
    const { body, files } = await readJsonOrMultipart(req, JSON_LIMIT);
    full.body = body;
    full.files = files;
    return handleImageGeneration(full);
  }

  if (path === '/v1/image_generation') {
    if (method !== 'POST') return methodNotAllowed(full, 'POST');
    full.body = await readJson(req, JSON_LIMIT);
    return handleMinimaxImageGeneration(full);
  }

  if (path === '/v1/videos') {
    if (method === 'GET') return handleOpenAiVideoList(full);
    if (method !== 'POST') return methodNotAllowed(full, 'GET, POST');
    // OpenAI 视频协议带参考图时提交 multipart（input_reference 文件），不带参考图或
    // 其它客户端仍可能发 JSON —— 两种都要收。
    const { body, files } = await readJsonOrMultipart(req, JSON_LIMIT);
    full.body = body;
    full.files = files;
    return handleOpenAiVideoCreate(full);
  }

  const videoContent = /^\/v1\/videos\/([^/]+)\/content\/?$/.exec(path);
  if (videoContent) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(full, 'GET');
    return handleOpenAiVideoContent(full, decodeURIComponent(videoContent[1]));
  }

  const videoItem = /^\/v1\/videos\/([^/]+)\/?$/.exec(path);
  if (videoItem) {
    const id = decodeURIComponent(videoItem[1]);
    if (method === 'GET') return handleOpenAiVideoGet(full, id);
    if (method === 'DELETE') return handleOpenAiVideoDelete(full, id);
    return methodNotAllowed(full, 'GET, DELETE');
  }

  if (path === '/v1/video_generation') {
    if (method !== 'POST') return methodNotAllowed(full, 'POST');
    full.body = await readJson(req, JSON_LIMIT);
    return handleMinimaxVideoCreate(full);
  }

  if (path === '/v1/query/video_generation') {
    if (method !== 'GET') return methodNotAllowed(full, 'GET');
    return handleMinimaxVideoQuery(full);
  }

  if (path === '/v1/files/retrieve') {
    if (method !== 'GET') return methodNotAllowed(full, 'GET');
    return handleMinimaxFileRetrieve(full);
  }

  const fileMatch = /^\/files\/([^/]+)\/?$/.exec(path);
  if (fileMatch) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(full, 'GET');
    return handleFile(full, fileMatch[1]);
  }

  throw new ApiError(404, `未实现的路径: ${method} ${path}`, { code: 'not_found' });
}

/** 与 handleRequest 的路由表保持一致的路径白名单（OPTIONS 探活用）。 */
function isKnownPath(path) {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === '/index.json' || normalized === '/health') return true;
  if (normalized === '/v1/models' || normalized === '/models') return true;
  if (/^\/v1\/models\/[^/]+$/.test(normalized)) return true;
  if (
    [
      '/v1/chat/completions',
      '/v1/images/generations',
      '/v1/images/edits',
      '/v1/image_generation',
      '/v1/videos',
      '/v1/video_generation',
      '/v1/query/video_generation',
      '/v1/files/retrieve',
    ].includes(normalized)
  ) {
    return true;
  }
  if (/^\/v1\/videos\/[^/]+(\/content)?$/.test(normalized)) return true;
  if (/^\/files\/[^/]+$/.test(normalized)) return true;
  return false;
}

function methodNotAllowed(ctx, allow) {
  sendJson(ctx.req, ctx.res, 405, {
    error: {
      message: `方法 ${ctx.method} 不被支持，请使用 ${allow}`,
      type: 'invalid_request_error',
      code: 'method_not_allowed',
    },
  }, { Allow: allow });
}

/**
 * Bearer 令牌校验。
 *
 * MOCK_API_KEY 为空 = 不校验（默认，方便开箱即用）。设置后按常量时间
 * 比较 SHA-256 摘要，避免长度差异泄露密钥长度。
 */
function verifyAuth(req, cfg) {
  if (!cfg.apiKey) return;
  const header = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = m ? m[1].trim() : '';
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(cfg.apiKey).digest();
  if (!timingSafeEqual(a, b)) throw unauthorized();
}
