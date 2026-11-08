import { ADMIN_EMAIL, ADMIN_PASSWORD } from './admin-credentials';

/** 数据备份 E2E 夹具：一份稳定已验证备份 + 每轮一份未验证备份。 */

const API = process.env.E2E_API ?? 'http://localhost:4100';

export interface BackupFixture {
  baselineIds: string[];
  verifiedId: string;
  verifiedFilename: string;
  unverifiedId: string;
  unverifiedFilename: string;
}

interface BackupRow {
  id: string;
  filename: string;
  status: string;
  verified: boolean;
}

class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} -> ${status}: ${body.slice(0, 800)}`);
  }
}

async function call<T>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(method, path, res.status, text);
  let json: { code?: number; data?: T; message?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new ApiError(method, path, res.status, `响应不是 JSON: ${text}`);
  }
  if (json.code !== 0) throw new ApiError(method, path, res.status, text);
  return json.data as T;
}

async function login(): Promise<string> {
  const data = await call<{ accessToken?: string }>('POST', '/auth/login', null, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const token = data.accessToken;
  if (!token) throw new Error('管理员登录成功但响应缺少 accessToken');
  return token;
}

export async function createBackupFixture(): Promise<BackupFixture> {
  const token = await login();
  const baselineIds = (await call<BackupRow[]>('GET', '/admin/backups', token)).map((row) => row.id);

  let verified = (await call<BackupRow[]>('GET', '/admin/backups', token)).find(
    (row) => row.status === 'succeeded' && row.verified,
  );
  if (!verified) {
    const created = await call<BackupRow>('POST', '/admin/backups', token);
    verified = await call<BackupRow>('POST', `/admin/backups/${created.id}/verify`, token);
  }
  if (!verified.verified) throw new Error('备份验证后状态仍为未验证');

  const unverified = await call<BackupRow>('POST', '/admin/backups', token);
  if (unverified.verified || unverified.status !== 'succeeded') {
    throw new Error(`新备份夹具状态异常: ${JSON.stringify(unverified)}`);
  }

  return {
    baselineIds,
    verifiedId: verified.id,
    verifiedFilename: verified.filename,
    unverifiedId: unverified.id,
    unverifiedFilename: unverified.filename,
  };
}

/**
 * 清理本轮新增的备份。
 *
 * 后端要求至少保留一份已验证备份，因此复用一个已有的已验证备份作为稳定
 * keeper；若库里原本没有，则本轮创建并验证的那份会永久保留。测试中手动
 * 备份出来的额外记录也会按 baseline 差异清理。
 */
export async function removeBackupFixture(fixture: BackupFixture | null): Promise<void> {
  if (!fixture) return;
  const token = await login();
  const records = await call<BackupRow[]>('GET', '/admin/backups', token);
  const baselineIds = new Set(fixture.baselineIds);

  for (const record of records) {
    if (record.id === fixture.verifiedId) continue;
    if (baselineIds.has(record.id)) continue;
    await call('DELETE', `/admin/backups/${record.id}`, token);
  }
}
