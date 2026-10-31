import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

/**
 * 渠道与模型子系统 P5 验收（`docs/channel-model-design.md` §10）。
 *
 * 覆盖「配置 → 选型 → 报价 → 生成 → 账单核对」整条链路：
 *
 *   1. 后台六页：渠道工作台、前台模型、用户分组、插件、生成账单、调用记录；
 *   2. C 端 `ModelPicker`：工具页高级设置里选出模型后，报价随之变化；
 *   3. 端到端：管理员给新账号发积分 → C 端按目录报价 → 建任务 → 轮询 →
 *      后台按任务 ID 查到账单并打开详情。
 *
 * 第 3 段需要「一条真正可用的 image 线路」。它不 mock 上游：目录里没有
 * `available=true` 的 `free_create` 模型时整段跳过（并写明原因），因为
 * 无线路本来就不是产品缺陷，而是这套环境还没配渠道。有可用模型却生成失败，
 * 则是真失败，必须让用例红。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';

const rows = (page: Page) => page.getByTestId('admin-table-row');

async function login(page: Page) {
  // 侧栏在 ≤1280px 折叠，分组标题按设计隐藏；宽表页需要足够宽度
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ensureAdminLogin(page);
}

/** 注册普通账号（注册限流时按服务端 Retry 窗口重试一次） */
async function registerUser(request: APIRequestContext): Promise<{ token: string; userId: string }> {
  const email = `e2e-model-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await request.post(`${API}/api/v1/auth/register`, {
      data: { email, password: 'E2e@123456', name: 'e2e-model' },
    });
    const text = await res.text();
    if (res.ok()) {
      const data = JSON.parse(text).data as { accessToken: string; user: { id: string } };
      return { token: data.accessToken, userId: data.user.id };
    }
    const waitSeconds = Number(text.match(/请\s*(\d+)\s*秒后再试/)?.[1] ?? 0);
    if (res.status() !== 429 || attempt === 3) {
      expect(res.ok(), `register ${res.status()}: ${text}`).toBeTruthy();
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitSeconds, 1) * 1000 + 250));
  }
  throw new Error('unreachable');
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `admin login ${res.status()}`).toBeTruthy();
  return (await res.json()).data.accessToken as string;
}

test.describe('渠道与模型 P5', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('渠道工作台：列表、必填校验与模型抽屉', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    // 导入面板与列表面板同时存在：导入是渠道批量迁移的唯一入口
    await expect(page.getByRole('heading', { name: '导入渠道配置' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '渠道列表' })).toBeVisible();

    // 必填校验在提交前拦下：名称 → Base URL，两次都要给出人话原因
    await page.getByRole('button', { name: '新建渠道' }).click();
    await expect(page.getByTestId('admin-drawer')).toBeVisible();
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('请填写渠道名称');

    await page.getByLabel('渠道名称').fill('e2e-未保存渠道');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('Base URL');

    // 取消：表单已脏，先弹放弃确认（ConfirmProvider，不是页内 ConfirmAction）
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible();
    await page.getByRole('button', { name: '放弃修改' }).click();
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);

    // 模型抽屉：凭证不回显，模型清单按渠道加载
    if ((await rows(page).count()) === 0) {
      test.skip(true, '当前库没有渠道；渠道模型抽屉需要一条已配置渠道');
    }
    await rows(page).first().getByRole('button', { name: '模型', exact: true }).click();
    await expect(page.getByTestId('admin-drawer')).toBeVisible();
    await expect(page.getByTestId('admin-drawer')).toContainText('渠道模型 · ');
    await expect(page.getByTestId('admin-drawer')).toContainText('基础信息');
  });

  test('前台模型：清单与路由模拟', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/logical-models`);
    await expect(page.getByRole('heading', { name: '前台模型' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '模型清单' })).toBeVisible();

    if ((await rows(page).count()) === 0) {
      test.skip(true, '当前库没有前台模型；路由模拟需要至少一个模型');
    }

    await rows(page).first().getByRole('button', { name: '模拟', exact: true }).click();
    await expect(page.getByTestId('admin-drawer')).toContainText('路由模拟 · ');
    await page.getByRole('button', { name: '开始模拟' }).click();

    // 模拟是只读：要么给出候选/选中线路，要么给出「为什么没落」
    await expect(page.getByTestId('admin-drawer')).toContainText('候选线路', { timeout: 15000 });
    await expect(page.getByTestId('admin-drawer')).toContainText('结论');
  });

  test('用户分组与插件：分组清单与契约校验结果可见', async ({ page }) => {
    await login(page);

    await page.goto(`${UI}/admin/user-groups`);
    await expect(page.getByRole('heading', { name: '用户分组' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '分组清单' })).toBeVisible();

    await page.goto(`${UI}/admin/plugins`);
    await expect(page.getByRole('heading', { name: '内置插件' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '插件清单' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 15000 });
    // 110 个内置插件随包入库，清单不可能为空
    await expect(page.getByText('插件总数').first()).toBeVisible();
  });

  test('生成账单与调用记录：筛选与详情可用', async ({ page }) => {
    await login(page);

    await page.goto(`${UI}/admin/billing-orders`);
    await expect(page.getByRole('heading', { name: '生成账单' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '账单列表' })).toBeVisible();
    // 五个状态始终有统计卡，不受分页影响
    for (const label of ['已预留', '计费中', '已结算', '已退款', '结果不明']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }

    await page.goto(`${UI}/admin/model-calls`);
    await expect(page.getByRole('heading', { name: '调用记录' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-filter')).toBeVisible();
  });

  test('C 端：高级设置里的模型选择器与实时报价', async ({ page }) => {
    await page.goto(`${UI}/product-kit`);
    const settings = page.getByRole('button', { name: /高级设置/ }).first();
    await expect(settings).toBeVisible({ timeout: 20000 });
    await settings.click();

    const picker = page.getByTestId('model-picker');
    await expect(picker).toBeVisible({ timeout: 15000 });

    if (await page.getByTestId('model-picker-empty').isVisible().catch(() => false)) {
      test.skip(true, '当前目录里 main_image 没有可用模型；选择器只能渲染空态');
    }

    const options = picker.getByTestId('model-option');
    expect(await options.count()).toBeGreaterThan(0);

    // 价格必须跟着所选模型走；加载中不算结果
    await expect(page.getByTestId('model-quote')).toHaveText(/积分|待定/, { timeout: 20000 });

    // 选另一档（若存在）后，选中态转移且价格重新计算
    if ((await options.count()) > 1) {
      const target = options.nth(1);
      if ((await target.getAttribute('data-available')) === 'true') {
        await target.click();
        await expect(target).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('model-quote')).toHaveText(/积分|待定/, { timeout: 20000 });
      }
    }
  });

  test('端到端：选型 → 报价 → 生成 → 账单核对', async ({ page, request }) => {
    test.setTimeout(180_000);

    const token = await adminToken(request);
    const { token: userToken, userId } = await registerUser(request);
    const auth = { Authorization: `Bearer ${userToken}` };

    // 选型：按目录找当前真能跑的 free_create 模型（无参考图，链路最短）
    const modelsRes = await request.get(`${API}/api/v1/models`, { headers: auth });
    expect(modelsRes.ok()).toBeTruthy();
    const models = (await modelsRes.json()).data.models as Array<{
      id: string;
      code: string;
      name: string;
      capability: string;
      available: boolean;
    }>;
    const model = models.find((entry) => entry.capability === 'free_create' && entry.available);
    if (!model) {
      test.skip(true, '目录里没有可用的 free_create 模型；生成段需要一条已配置的 image 线路');
    }

    // 新账号没有积分：由管理员按「必须写原因」的既有入口发放
    const adjustRes = await request.post(`${API}/api/v1/admin/credits/adjust`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { userId, delta: 200, reason: 'E2E：渠道与模型 P5 端到端验收' },
    });
    expect(adjustRes.ok(), `credit adjust ${adjustRes.status()}: ${await adjustRes.text()}`).toBeTruthy();

    // 报价：同一模型同一参数下，报价必须先于建任务给出确定金额
    const quoteRes = await request.post(`${API}/api/v1/models/${model!.id}/quote`, {
      headers: auth,
      data: { capability: 'free_create', options: { ratio: '1:1', size: '1k' } },
    });
    expect(quoteRes.ok()).toBeTruthy();
    const quote = (await quoteRes.json()).data.quote as {
      amountMicrocredits: number | null;
      billingMode: string;
    };
    expect(quote.amountMicrocredits, '有可用线路的模型必须能报价').not.toBeNull();

    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: auth,
      data: { name: 'E2E 模型链路' },
    });
    expect(projectRes.ok()).toBeTruthy();
    const projectId = (await projectRes.json()).data.id as string;

    const createRes = await request.post(`${API}/api/v1/generate`, {
      headers: auth,
      data: {
        projectId,
        capability: 'free_create',
        logicalModelId: model!.id,
        inputAssetIds: [],
        params: { prompt: 'E2E：白色背景的陶瓷杯，商品摄影', ratio: '1:1', size: '1k' },
      },
    });
    const createText = await createRes.text();
    expect(createRes.ok(), `generate ${createRes.status()}: ${createText}`).toBeTruthy();
    const task = JSON.parse(createText).data as { taskId: string; status: string };

    // 轮询到终态：只有 succeeded 才继续核对账单
    let final: { status: string; errorCode?: string | null; errorMessage?: string | null } | null = null;
    for (let i = 0; i < 60; i += 1) {
      const poll = await request.get(`${API}/api/v1/tasks/${task.taskId}`, { headers: auth });
      expect(poll.ok()).toBeTruthy();
      final = (await poll.json()).data;
      if (['succeeded', 'failed', 'cancelled'].includes(final!.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    expect(final?.status, `任务未到终态：${JSON.stringify(final)}`).toBe('succeeded');

    // 账单核对：后台按任务 ID 能查到这条账单，详情里任务 / 模型 / 金额齐全
    await login(page);
    await page.goto(`${UI}/admin/billing-orders`);
    await expect(page.getByRole('heading', { name: '生成账单' })).toBeVisible({ timeout: 20000 });
    await page.getByLabel('任务 ID').fill(task.taskId);
    await page.getByRole('button', { name: '查询' }).click();

    // 失败切线会在同一 taskId 下留一条已退款账单，因此按状态挑出成功那条
    const settledRow = rows(page).filter({ hasText: '已结算' }).first();
    await expect(settledRow).toBeVisible({ timeout: 15000 });
    await settledRow.getByRole('button', { name: '详情' }).click();
    const drawer = page.getByTestId('admin-drawer');
    await expect(drawer).toContainText('账单详情');
    await expect(drawer).toContainText(task.taskId);
    // 账单里的模型口径是前台模型 code（`BillingOrder.model`），不是渠道模型
    await expect(drawer).toContainText(model!.code);
  });
});
