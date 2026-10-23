/**
 * seed-workbench-thumbs.ts
 *
 * 为工作台 12 项能力各生成一条真实产出, 使工作台卡片缩略图全部有真实结果可展示
 * (不再是"暂无示例"空态)。全部走真实 API: 登录 -> 选项目 -> 选输入图 -> 提交 -> 轮询。
 *
 * 幂等: 已有 succeeded 任务的能力会跳过, 不会重复生成。
 *
 * 用法: SEED_EMAIL=you@example.com SEED_PASSWORD='…' \
 *         API=http://localhost:4100 npx ts-node -T scripts/seed-workbench-thumbs.ts
 * 凭据没有默认值 —— 2026-10-22 起项目不再内置演示账号，缺凭据直接报错退出，
 * 否则会静默打到一个不存在的账号上，报出一串看不懂的 401。
 */
import { SUBMITTABLE_CAPABILITY_IDS } from '../src/capabilities/capability.registry';

const API = process.env.API ?? 'http://localhost:4100';
const EMAIL = process.env.SEED_EMAIL ?? process.env.SEED_USER_EMAIL ?? '';
const PASSWORD = process.env.SEED_PASSWORD ?? process.env.SEED_USER_PASSWORD ?? '';

interface Json {
  code: number;
  msg: string;
  data: any;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as Json;
  if (!res.ok || body.code !== 0) {
    throw new Error(`${path} -> ${res.status} ${body.code} ${body.msg}`);
  }
  return body.data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('缺少凭据：请设置 SEED_EMAIL / SEED_PASSWORD（或 SEED_USER_EMAIL / SEED_USER_PASSWORD）');
  }

  // 1. 登录
  const auth = await req<{ accessToken: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const H = { Authorization: `Bearer ${auth.accessToken}` };

  // 2. 输入素材优先: 取一个非空的 original, 用它所属的 project (资产与任务必须同项目)
  const assetsRes = await req<{ items: Array<{ id: string; kind: string; sourceUrl: string; projectId: string }> }>(
    '/api/v1/assets?limit=100',
    { headers: H },
  );
  const input = assetsRes.items.find((a) => a.kind === 'original' && !a.sourceUrl.endsWith('.png'));
  // 双输入能力 (爆款复刻) 需要两张不同的图: 取第二张不同的 original, 没有则复用第一张
  const input2 = assetsRes.items.find((a) => a.kind === 'original' && !a.sourceUrl.endsWith('.png') && a.id !== input?.id);
  let projectId = input?.projectId;
  if (!projectId) {
    const projects = await req<Array<{ id: string }>>('/api/v1/projects', { headers: H });
    projectId = projects[0]?.id;
    if (!projectId) {
      const created = await req<{ id: string }>('/api/v1/projects', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ name: '默认项目' }),
      });
      projectId = created.id;
    }
  }
  if (!input) throw new Error('没有可用的原始素材, 请先上传一张商品图');

  // 3. 已有成功任务的能力 (幂等)
  const tasks = await req<Array<{ capability: string; status: string }>>('/api/v1/tasks', { headers: H });
  const done = new Set(tasks.filter((t) => t.status === 'succeeded').map((t) => t.capability));

  // 5. 逐能力提交 (双输入能力传同一张图两次)
  const todo = SUBMITTABLE_CAPABILITY_IDS.filter((id) => !done.has(id));
  console.log(`[seed] 已有产出: ${done.size} 项; 待生成: ${todo.length} 项 -> ${todo.join(', ')}`);
  if (todo.length === 0) return;

  const submitted: Array<{ id: string; capability: string }> = [];
  for (const capability of todo) {
    const inputs = capability === 'hot_remake' ? [input.id, input2?.id ?? input.id] : [input.id];
    const t = await req<{ taskId: string }>('/api/v1/generate', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ projectId, capability, inputAssetIds: inputs }),
    });
    submitted.push({ id: t.taskId, capability });
    console.log(`[seed] 提交 ${capability} -> task ${t.taskId}`);
  }

  // 6. 轮询到全部终态
  const deadline = Date.now() + 120_000;
  const pending = new Map(submitted.map((s) => [s.id, s.capability]));
  while (pending.size > 0 && Date.now() < deadline) {
    await sleep(1500);
    for (const [id, capability] of [...pending]) {
      const t = await req<{ id: string; status: string; errorCode?: string }>(`/api/v1/tasks/${id}`, { headers: H });
      if (t.status === 'succeeded') {
        console.log(`[seed] ✓ ${capability}`);
        pending.delete(id);
      } else if (t.status === 'failed') {
        console.log(`[seed] ✗ ${capability} failed: ${t.errorCode ?? 'unknown'}`);
        pending.delete(id);
      }
    }
  }
  if (pending.size > 0) {
    console.log(`[seed] 超时未完成: ${[...pending.values()].join(', ')}`);
    process.exit(1);
  }
  console.log('[seed] 全部完成');
}

main().catch((e) => {
  console.error('[seed] 失败:', (e as Error).message);
  process.exit(1);
});
