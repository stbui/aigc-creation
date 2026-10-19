import { API_BASE } from './constants';
import { API_ROOT, extractErrorMessage, unwrapEnvelope } from './http';
import { clearStoredEmail, clearToken, getToken } from './auth';
import type {
  AssetListResult,
  AssetUploadResponse,
  AuthResponse,
  GenerateRequest,
  GenerateResponse,
  LoginRequest,
  Project,
  RegisterRequest,
  StatsOverview,
  Task,
  TaskListResult,
} from '../types/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

const BASE = API_ROOT;

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  signal?: AbortSignal | null;
  // 具体 DTO 类型 (LoginRequest 等) 没有索引签名, 不能直接赋值给 Record<string, unknown>,
  // 故用 unknown 收口后在运行时 JSON.stringify。
  body?: BodyInit | Record<string, unknown> | object | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let body: BodyInit | null | undefined;
  if (options.body && options.body instanceof FormData) {
    body = options.body;
  } else if (options.body) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  } else {
    body = undefined;
  }

  const res = await fetch(`${BASE}${path}`, {
    method: options.method,
    headers,
    body,
    signal: options.signal,
  });

  // 后端 ResponseInterceptor 把所有成功响应包成 { code: 0, data, message: '' },
  // 必须先剥掉外层信封才能拿到业务数据, 否则每个调用都只拿到 {code,data,message}。
  if (!res.ok) {
    // 401 (token 过期/无效): 清凭证并广播, 交由 AuthProvider 登出并跳登录页。
    // 登录接口自身的 401 (密码错误) 不算会话失效, 排除。
    if (res.status === 401 && path !== '/auth/login') {
      clearToken();
      clearStoredEmail();
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    let message = `请求失败（${res.status}）`;
    try {
      message = extractErrorMessage(await res.json(), message);
    } catch {
      /* 保留默认文案 */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;

  return unwrapEnvelope<T>(JSON.parse(text));
}

function asList<T>(res: TaskListResult | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res as T[];
  return [];
}

export const authApi = {
  login: (data: LoginRequest) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: data }),
  register: (data: RegisterRequest) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: data }),
};

export const projectsApi = {
  list: () => request<TaskListResult>('/projects').then((r) => asList<Project>(r)),
  create: (name: string) =>
    request<Project>('/projects', { method: 'POST', body: { name } }),
};

export const assetsApi = {
  // projectId 必传: 后端 assets.service.ts:21 校验缺失即 400
  upload: (file: File, projectId: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', projectId);
    return request<AssetUploadResponse>('/assets/upload', { method: 'POST', body: fd });
  },

  /** 素材库列表: kind=original|generated, capability 过滤, 分页 */
  list: (params: { kind?: string; capability?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', params.kind);
    if (params.capability) qs.set('capability', params.capability);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AssetListResult>(`/assets${suffix}`);
  },

  /** 删除素材 (生成图会连带删除产出它的任务) */
  remove: (id: string) => request<{ id: string; removedTasks: number }>(`/assets/${id}`, { method: 'DELETE' }),
};

export const generateApi = {
  start: (data: GenerateRequest) =>
    request<GenerateResponse>('/generate', { method: 'POST', body: data }),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  list: () => request<TaskListResult>('/tasks').then((r) => asList<Task>(r)),
  remove: (id: string) => request<{ id: string; removedAsset: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};

export const statsApi = {
  overview: () => request<StatsOverview>('/stats/overview'),
};

export function toAbsoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}
