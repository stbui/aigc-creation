import { ApiError } from './errors.js';

/** 读请求体，超过上限直接 413。 */
export function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new ApiError(413, `请求体超过 ${limitBytes} 字节`, { code: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limitBytes) {
  const raw = await readBody(req, limitBytes);
  if (!raw.length) return {};
  const text = raw.toString('utf8').trim();
  if (!text) return {};
  try {
    const json = JSON.parse(text);
    if (json === null || typeof json !== 'object') {
      throw new ApiError(400, '请求体必须是 JSON 对象', { code: 'invalid_json' });
    }
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, `请求体不是合法 JSON: ${e.message}`, { code: 'invalid_json' });
  }
}

/** 是否为 multipart/form-data 请求（与参数顺序、大小写无关）。 */
export function isMultipart(req) {
  return /^multipart\/form-data\b/i.test(String(req.headers['content-type'] ?? ''));
}

/**
 * 按 content-type 读提交体：
 * - `multipart/form-data` → `{ body: 字段表, files: 文件表 }`（文件不落内存之外的地方）；
 * - 其余 → JSON 解析，`files` 为空对象。
 *
 * OpenAI 视频接口在带参考图时必须用 multipart 的 `input_reference` 文件字段提交，
 * 只按 JSON 解析会让正文以 `--boundary` 开头，直接报 `No number after minus sign`。
 */
export async function readJsonOrMultipart(req, limitBytes) {
  if (!isMultipart(req)) return { body: await readJson(req, limitBytes), files: {} };
  return readMultipart(req, limitBytes);
}

/** 解析 multipart/form-data：返回普通字段与文件字段两张表。 */
export async function readMultipart(req, limitBytes) {
  const boundary = multipartBoundary(String(req.headers['content-type'] ?? ''));
  if (!boundary) throw new ApiError(400, 'multipart 请求缺少 boundary', { code: 'invalid_multipart' });

  const raw = await readBody(req, limitBytes);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = raw.indexOf(delimiter);
  if (cursor === -1) throw new ApiError(400, 'multipart 请求体缺少定界符', { code: 'invalid_multipart' });

  while (cursor !== -1) {
    const afterDelimiter = cursor + delimiter.length;
    // 结束定界符 `--boundary--`
    if (raw[afterDelimiter] === 0x2d && raw[afterDelimiter + 1] === 0x2d) break;
    // 定界符后应跟 CRLF（宽容 LF）；否则说明 boundary 配错
    let start = afterDelimiter;
    if (raw[start] === 0x0d && raw[start + 1] === 0x0a) start += 2;
    else if (raw[start] === 0x0a) start += 1;
    else throw new ApiError(400, 'multipart 定界符后缺少换行', { code: 'invalid_multipart' });

    const next = raw.indexOf(delimiter, start);
    if (next === -1) throw new ApiError(400, 'multipart 请求体缺少结束定界符', { code: 'invalid_multipart' });
    parseMultipartPart(raw.subarray(start, next), fields, files);
    cursor = next;
  }

  return { body: fields, files };
}

function multipartBoundary(contentType) {
  const match = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? match[1] || match[2] : null;
}

/** 解析单个 part：头 + 空行 + 正文（末尾的分隔 CRLF 不属于正文）。 */
function parseMultipartPart(part, fields, files) {
  let headerEnd = part.indexOf('\r\n\r\n');
  let separatorLength = 4;
  if (headerEnd === -1) {
    headerEnd = part.indexOf('\n\n');
    separatorLength = 2;
  }
  if (headerEnd === -1) return;

  const headers = {};
  for (const line of part.subarray(0, headerEnd).toString('utf8').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }

  const name = headerParam(headers['content-disposition'] ?? '', 'name');
  if (!name) return;

  let content = part.subarray(headerEnd + separatorLength);
  if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
    content = content.subarray(0, content.length - 2);
  }

  const filename = headerParam(headers['content-disposition'] ?? '', 'filename');
  if (filename !== null) {
    files[name] = {
      filename,
      contentType: headers['content-type'] || 'application/octet-stream',
      buffer: content,
    };
  } else {
    fields[name] = content.toString('utf8');
  }
}

/** 取 header 参数值（支持 quoted-string 与裸值）；不存在返回 null。 */
function headerParam(header, key) {
  const quoted = new RegExp(`${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, '$1');
  const bare = new RegExp(`${key}\\s*=\\s*([^;\\s]+)`, 'i').exec(header);
  return bare ? bare[1] : null;
}

export function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function sendJson(req, res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    ...headers,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

/**
 * 发二进制，支持单个 Range（视频播放器会发 Range，浏览器 <video> 依赖 206）。
 */
export function sendBuffer(req, res, status, buffer, mime, extra = {}) {
  const range = parseRange(req.headers.range, buffer.length);
  if (range) {
    const { start, end } = range;
    const slice = buffer.subarray(start, end + 1);
    res.writeHead(206, {
      ...corsHeaders(req),
      'Content-Type': mime,
      'Content-Length': String(slice.length),
      'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
      'Accept-Ranges': 'bytes',
      ...extra,
    });
    if (req.method === 'HEAD') res.end();
    else res.end(slice);
    return;
  }
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': mime,
    'Content-Length': String(buffer.length),
    'Accept-Ranges': 'bytes',
    ...extra,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(buffer);
}

export function sendError(req, res, err, logger) {
  const apiError =
    err instanceof ApiError
      ? err
      : new ApiError(500, err?.message ? String(err.message) : '内部错误', { code: 'internal_error' });
  if (apiError.status >= 500) logger?.error?.(`请求处理失败: ${err?.stack ?? err}`);
  sendJson(req, res, apiError.status, apiError.toJSON());
}

function parseRange(header, total) {
  if (!header || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? total - 1 : Math.min(Number(rawEnd), total - 1);
  if (!Number.isFinite(start) || start > end || start >= total) return null;
  return { start, end };
}

/** 绝对地址：优先 MOCK_PUBLIC_BASE，否则用请求的 Host 还原调用方可达的地址。 */
export function baseUrlOf(req, cfg) {
  if (cfg.publicBase) return cfg.publicBase;
  const proto = cfg.trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : 'http';
  const host = (cfg.trustProxy && req.headers['x-forwarded-host'])
    ? String(req.headers['x-forwarded-host']).split(',')[0].trim()
    : req.headers.host || `${cfg.host}:${cfg.port}`;
  return `${proto}://${host}`;
}

export function pathOnly(url) {
  const i = url.indexOf('?');
  return i >= 0 ? url.slice(0, i) : url;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 简洁请求日志：时间 / 方法 / 路径 / 状态 / 耗时。 */
export function createLogger(cfg) {
  const quiet = cfg.logLevel === 'quiet' || cfg.logLevel === 'error';
  const debug = cfg.logLevel === 'debug';
  const stamp = () => new Date().toISOString();
  return {
    info: (...args) => {
      if (!quiet) console.log(`[${stamp()}]`, ...args);
    },
    debug: (...args) => {
      if (debug) console.log(`[${stamp()}] DEBUG`, ...args);
    },
    error: (...args) => console.error(`[${stamp()}] ERROR`, ...args),
    request: (method, path, status, ms) => {
      if (quiet) return;
      console.log(`[${stamp()}] ${method.padEnd(7)} ${path} ${status} ${ms}ms`);
    },
  };
}
