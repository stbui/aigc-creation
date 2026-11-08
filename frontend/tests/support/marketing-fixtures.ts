import { ADMIN_EMAIL, ADMIN_PASSWORD } from './admin-credentials';

/** 营销中心 E2E 夹具：固定券码，重复执行时复用存量数据。 */

const API = process.env.E2E_API ?? 'http://localhost:4100';
const COUPON_CODE = 'E2EMKT01';
const COUPON_NAME = 'E2E 营销编辑夹具';

export interface CouponFixture {
  id: string;
  code: string;
  name: string;
}

interface CouponRow {
  id: string;
  code: string;
  name: string;
  status: string;
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
  if (!data.accessToken) throw new Error('管理员登录成功但响应缺少 accessToken');
  return data.accessToken;
}

async function findCoupon(token: string): Promise<CouponRow | undefined> {
  const list = await call<{ items?: CouponRow[] }>(
    'GET',
    `/admin/coupons?keyword=${COUPON_CODE}&pageSize=100`,
    token,
  );
  return list.items?.find((item) => item.code === COUPON_CODE);
}

export async function createCouponFixture(): Promise<CouponFixture> {
  const token = await login();
  let coupon = await findCoupon(token);
  if (!coupon) {
    coupon = await call<CouponRow>('POST', '/admin/coupons', token, {
      code: COUPON_CODE,
      name: COUPON_NAME,
      type: 'full_cut',
      value: 1000,
      thresholdCents: 0,
      scope: 'all',
      totalCount: 100,
      perUserLimit: 1,
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: '2035-12-31T23:59:59.000Z',
      status: 'on',
    });
  } else if (coupon.status !== 'on') {
    // 上一轮 afterAll 会停用夹具券；复跑时先恢复启用，保证列表写操作可验证。
    coupon = await call<CouponRow>('PATCH', `/admin/coupons/${coupon.id}/toggle`, token);
    if (coupon.status !== 'on') {
      throw new Error(`优惠券夹具启用失败: ${JSON.stringify(coupon)}`);
    }
  }
  return { id: coupon.id, code: coupon.code, name: coupon.name };
}

/** 清理固定夹具：无订单时直接删除；有历史引用时退回停用。 */
export async function removeCouponFixture(): Promise<void> {
  const token = await login();
  const coupon = await findCoupon(token);
  if (!coupon) return;

  try {
    await call('DELETE', `/admin/coupons/${coupon.id}`, token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    if (coupon.status === 'on') {
      await call('PATCH', `/admin/coupons/${coupon.id}/toggle`, token);
    }
  }
}
