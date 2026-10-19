import { API_BASE, API_PREFIX } from './constants';

/**
 * HTTP 层公共设施。
 *
 * 后端 ResponseInterceptor 把所有成功响应包成 `{ code: 0, data, message: '' }`
 * (拦截器见 backend/src/common/response.interceptor.ts), 前端必须在唯一入口剥壳,
 * 否则每个调用点都要重复判断信封、迟早漂移 —— api.ts 与 capabilities.ts 共用此模块。
 */
export const API_ROOT = `${API_BASE}${API_PREFIX}`;

interface Envelope<T> {
  code: number;
  data: T;
  message?: string;
}

/** 剥离统一响应信封; 不是信封形态 (如静态 JSON) 时原样返回 */
export function unwrapEnvelope<T>(json: unknown): T {
  if (json && typeof json === 'object' && 'code' in json && 'data' in json) {
    return (json as Envelope<T>).data;
  }
  return json as T;
}

/** 从后端错误体里取一句话错误文案 (兼容 message/error/msg 三种字段名) */
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const msg = b.message ?? b.error ?? b.msg;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}
