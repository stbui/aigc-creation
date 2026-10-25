import path from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export function isPathInside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export function resolveWorkingDirectory(root, requested = '.') {
  if (typeof requested !== 'string' || requested.length > 4096) {
    throw new HttpError(400, '工作目录参数无效');
  }

  const rootReal = realpathSync(root);
  const candidate = path.resolve(rootReal, requested || '.');

  let realCandidate;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    throw new HttpError(400, `工作目录不存在：${requested || '.'}`);
  }

  if (!isPathInside(rootReal, realCandidate)) {
    throw new HttpError(403, '工作目录必须位于允许的根目录内');
  }
  if (!statSync(realCandidate).isDirectory()) {
    throw new HttpError(400, '工作目录不是文件夹');
  }

  return realCandidate;
}

export function toDisplayPath(root, target) {
  const relative = path.relative(root, target);
  return relative === '' ? '.' : relative;
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readJsonBody(req, limit = 256 * 1024) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > limit) {
    throw new HttpError(413, '请求体过大');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求体过大');
    chunks.push(chunk);
  }

  if (size === 0) return {};

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new HttpError(400, '请求体必须是合法的 JSON 对象');
  }
}

export function writeJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}
