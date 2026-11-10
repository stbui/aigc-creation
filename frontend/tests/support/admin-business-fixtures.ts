import { ADMIN_EMAIL, ADMIN_PASSWORD } from './admin-credentials';
import {
  createModelSuiteFixture,
  removeModelSuiteFixture,
  type ModelSuiteFixture,
} from './model-fixtures';

/**
 * 高频后台动线所需的商品 / 工单夹具。
 *
 * 商品与工单都没有删除 API：商品下架后仍要保留历史对账依据，工单关闭后
 * 仍要保留客服记录。因此这里使用固定的 E2E 标记复用同一份数据，并在
 * afterAll 把商品下架、工单关闭；重复执行不会持续堆积新记录。
 */

const API = process.env.E2E_API ?? 'http://localhost:4100';
const PRODUCT_SKU = 'E2E-UNSAVED-GUARD';
const PRODUCT_NAME = 'E2E 未保存保护商品';
const TICKET_MARKER = 'E2E 未保存保护工单';

type TicketRow = { id: string; subject: string; status: string };
type ProductRow = { id: string; sku: string; status: string };
type OrderRow = { id: string; orderNo: string; status: string };

export interface AdminBusinessFixture {
  productId: string;
  productName: string;
  ticketMarker: string;
  orderId: string;
  orderNo: string;
}

export interface AdminTaskHistoryFixture {
  taskIds: string[];
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
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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
  if (json.code !== 0) {
    throw new ApiError(method, path, res.status, text);
  }
  return json.data as T;
}

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError('POST', '/auth/login', res.status, text);
  const json = JSON.parse(text) as { code?: number; data?: { accessToken?: string } };
  const token = json.data?.accessToken;
  if (json.code !== 0 || !token) {
    throw new ApiError('POST', '/auth/login', res.status, text);
  }
  return token;
}

async function ensureProduct(token: string): Promise<ProductRow> {
  const products = await call<ProductRow[]>(
    'GET',
    '/admin/products',
    token,
  );
  const existing = products.find((product) => product.sku === PRODUCT_SKU);
  if (existing) {
    if (existing.status !== 'offline') {
      await call('PATCH', `/admin/products/${existing.id}/status`, token, { status: 'offline' });
    }
    return { ...existing, status: 'offline' };
  }

  const created = await call<ProductRow>('POST', '/admin/products', token, {
    sku: PRODUCT_SKU,
    name: PRODUCT_NAME,
    description: '后台未保存保护 E2E 夹具，afterAll 会恢复为下架状态',
    type: 'credits',
    priceCents: 100,
    credits: 10,
    creditsValidDays: 0,
    grantType: 'immediate',
    status: 'offline',
    sortOrder: 0,
  });
  if (!created.id) throw new Error('创建商品夹具成功但响应缺少 id');
  return { ...created, status: 'offline' };
}

/**
 * 复用固定幂等键创建一笔真实待支付订单。
 *
 * 商品夹具平时保持下架，避免出现在 C 端售卖列表；下单前临时上架，创建后
 * 无论成功与否立即恢复下架。固定幂等键让重复执行复用同一订单，不会持续
 * 堆积待支付单。历史轮次已取消的订单仍保留在后台列表中，可直接复用。
 */
async function ensureOrder(token: string, productId: string): Promise<OrderRow> {
  await call('PATCH', `/admin/products/${productId}/status`, token, { status: 'active' });
  try {
    const order = await call<OrderRow>('POST', '/orders', token, {
      idempotencyKey: 'e2e-admin-ux-order-v1',
      productId,
      quantity: 1,
    });
    if (!order.id || !order.orderNo) {
      throw new Error('创建订单夹具成功但响应缺少 id/orderNo');
    }
    return order;
  } finally {
    await call('PATCH', `/admin/products/${productId}/status`, token, { status: 'offline' });
  }
}

async function ensureTicket(token: string): Promise<void> {
  const query = encodeURIComponent(TICKET_MARKER);
  const list = await call<{ items?: TicketRow[] }>(
    'GET',
    `/admin/tickets?q=${query}&limit=20&offset=0`,
    token,
  );
  const existing = list.items?.[0];
  if (existing) {
    if (existing.status !== 'open') {
      await call('PATCH', `/admin/tickets/${existing.id}`, token, { status: 'open' });
    }
    return;
  }

  await call('POST', '/tickets', token, {
    type: 'bug',
    subject: TICKET_MARKER,
    content: '用于验证工单回复未发送时关闭详情的未保存保护，afterAll 会关闭。',
    priority: 'normal',
  });
}

export async function createAdminBusinessFixture(): Promise<AdminBusinessFixture> {
  const token = await login();
  const product = await ensureProduct(token);
  await ensureTicket(token);
  const order = await ensureOrder(token, product.id);
  return {
    productId: product.id,
    productName: PRODUCT_NAME,
    ticketMarker: TICKET_MARKER,
    orderId: order.id,
    orderNo: order.orderNo,
  };
}

/** 无删除 API，按业务状态回收：商品下架，工单关闭。 */
export async function removeAdminBusinessFixture(
  fixture: AdminBusinessFixture | null,
): Promise<void> {
  const token = await login();
  if (fixture?.productId) {
    await call('PATCH', `/admin/products/${fixture.productId}/status`, token, {
      status: 'offline',
    });
  }

  if (fixture?.orderId) {
    const order = await call<OrderRow>('GET', `/orders/${fixture.orderId}`, token);
    if (order.status === 'pending') {
      await call('POST', `/orders/${fixture.orderId}/cancel`, token);
    }
  }

  const query = encodeURIComponent(TICKET_MARKER);
  const list = await call<{ items?: TicketRow[] }>(
    'GET',
    `/admin/tickets?q=${query}&limit=50&offset=0`,
    token,
  );
  for (const ticket of list.items ?? []) {
    if (ticket.status !== 'closed') {
      await call('PATCH', `/admin/tickets/${ticket.id}`, token, { status: 'closed' });
    }
  }
}

const TASK_FIXTURE_COUNT = 21;
const TASK_BATCH_SIZE = 20;

async function registerTaskFixtureUser(): Promise<{ token: string; userId: string }> {
  const email = `e2e-task-page-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${API}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'E2e@123456', name: 'e2e-task-page' }),
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text).data as {
        accessToken: string;
        user: { id: string };
      };
      return { token: data.accessToken, userId: data.user.id };
    }
    const waitSeconds = Number(text.match(/请\s*(\d+)\s*秒后再试/)?.[1] ?? 0);
    if (res.status() !== 429 || attempt === 3) {
      throw new ApiError('POST', '/auth/register', res.status, text);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitSeconds, 1) * 1000 + 250));
  }
  throw new Error('unreachable');
}

async function waitForSucceededTask(
  token: string,
  taskId: string,
): Promise<{ id: string; status: string }> {
  let last: { id: string; status: string; errorMessage?: string | null } | null = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const res = await fetch(`${API}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError('GET', `/tasks/${taskId}`, res.status, text);
    last = JSON.parse(text).data as { id: string; status: string; errorMessage?: string | null };
    if (['succeeded', 'failed', 'cancelled'].includes(last.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (last?.status !== 'succeeded') {
    throw new Error(`任务夹具未成功: ${taskId} ${JSON.stringify(last)}`);
  }
  return last;
}

/**
 * 生成足够多的真实成功任务，保证后台任务列表存在第二页。
 *
 * 全链路使用仿真网关夹具：管理员 API 建渠道/模型，管理员调整积分，
 * C 端登录用户调用真实 `/generate`，再轮询到 succeeded。测试结束后按
 * 任务删除接口回收，不直接写数据库，也不放宽任务状态断言。
 */
export async function createAdminTaskHistoryFixture(): Promise<AdminTaskHistoryFixture> {
  let modelFixture: ModelSuiteFixture | null = null;
  const taskIds: string[] = [];
  let adminToken = '';

  try {
    modelFixture = await createModelSuiteFixture();
    adminToken = await login();
    let created = 0;
    while (created < TASK_FIXTURE_COUNT) {
      const user = await registerTaskFixtureUser();
      const auth = { Authorization: `Bearer ${user.token}` };
      const count = Math.min(TASK_BATCH_SIZE, TASK_FIXTURE_COUNT - created);

      const adjustRes = await fetch(`${API}/api/v1/admin/credits/adjust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          userId: user.userId,
          delta: count * 10,
          reason: '后台任务分页 E2E 夹具额度',
        }),
      });
      const adjustText = await adjustRes.text();
      if (!adjustRes.ok) {
        throw new ApiError('POST', '/admin/credits/adjust', adjustRes.status, adjustText);
      }

      const projectRes = await fetch(`${API}/api/v1/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ name: `E2E 任务分页夹具 ${created + 1}-${created + count}` }),
      });
      const projectText = await projectRes.text();
      if (!projectRes.ok) {
        throw new ApiError('POST', '/projects', projectRes.status, projectText);
      }
      const projectId = (JSON.parse(projectText).data as { id: string }).id;

      const createResponses = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          fetch(`${API}/api/v1/generate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': `e2e-task-page-${Date.now()}-${created + index}`,
              ...auth,
            },
            body: JSON.stringify({
              projectId,
              capability: 'free_create',
              logicalModelId: modelFixture!.freeCreateId,
              inputAssetIds: [],
              params: { prompt: `E2E 后台任务分页夹具 #${created + index + 1}` },
            }),
          }),
        ),
      );
      for (const res of createResponses) {
        const text = await res.text();
        if (!res.ok) throw new ApiError('POST', '/generate', res.status, text);
        taskIds.push((JSON.parse(text).data as { taskId: string }).taskId);
      }

      await Promise.all(taskIds.slice(created).map((taskId) => waitForSucceededTask(user.token, taskId)));
      created += count;
    }

    return { taskIds };
  } catch (error) {
    if (adminToken && taskIds.length > 0) {
      await fetch(`${API}/api/v1/admin/tasks/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ ids: taskIds, action: 'delete' }),
      }).catch(() => undefined);
    }
    await removeModelSuiteFixture(modelFixture).catch(() => undefined);
    throw error;
  }
}

export async function removeAdminTaskHistoryFixture(
  fixture: AdminTaskHistoryFixture | null,
): Promise<void> {
  try {
    if (fixture?.taskIds.length) {
      const token = await login();
      const res = await fetch(`${API}/api/v1/admin/tasks/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids: fixture.taskIds, action: 'delete' }),
      });
      const text = await res.text();
      if (!res.ok) throw new ApiError('POST', '/admin/tasks/batch', res.status, text);
    }
  } finally {
    await removeModelSuiteFixture(null);
  }
}
