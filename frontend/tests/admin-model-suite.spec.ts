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
/** 渠道工作台左列的渠道条目（主从布局，不再是表格行） */
const channelItems = (page: Page) => page.getByTestId('admin-channel-item');

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

  test('渠道工作台：左列渠道导航与右侧内联模型管理', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    // 必填校验在提交前拦下：名称 → Base URL，两次都要给出人话原因
    await page.getByRole('button', { name: '新建渠道' }).first().click();
    await expect(page.getByTestId('admin-drawer')).toBeVisible();
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('请填写渠道名称');

    await page.getByLabel('渠道名称').fill('e2e-未保存渠道');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('Base URL');

    // 新建渠道没有凭证就是一条永远 401 的线路，API Key 必填
    await page.getByLabel('Base URL').fill('https://example.com');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('请填写 API Key 或 Access Key');

    // 自定义请求头是结构化编辑器：系统托管的头在提交前就拦下，并指出是哪一行
    await page.getByRole('button', { name: '添加请求头' }).click();
    await page.getByLabel('请求头 1 名称').fill('authorization');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('由系统管理');
    await page.getByRole('button', { name: '删除请求头 1' }).click();

    // 取消：表单已脏，先弹放弃确认（ConfirmProvider，不是页内 ConfirmAction）
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible();
    await page.getByRole('button', { name: '放弃修改' }).click();
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);

    /*
     * 模型不再弹抽屉：选中左列渠道后，右侧详情区直接渲染该渠道的模型清单。
     * 选中态落在 `aria-pressed`（辅助技术读得到），右侧标题跟着换成渠道名。
     */
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);
    const first = channelItems(page).first();
    const channelName = await first.getByTestId('admin-channel-name').innerText();
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');

    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(channelName);
    await expect(detail).toContainText('模型清单');
    // 详情区常驻，不再有承载模型的抽屉
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);
  });

  test('渠道详情：编辑/复制/导出/启停/删除都在头部，停用需二次确认', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);
    await channelItems(page).first().click();

    // 渠道级动作全部外露：编辑、复制、导出、启停、删除
    const detail = page.locator('#admin-channel-detail');
    for (const name of ['编辑', '复制', '导出', '删除']) {
      await expect(detail.getByRole('button', { name, exact: true })).toBeVisible();
    }
    const toggle = detail.getByRole('button', { name: /^(停用|启用)$/ });
    await expect(toggle).toBeVisible();
    const disabling = (await toggle.innerText()).trim() === '停用';

    // 停用会让整条渠道退出路由目录：页内确认条必须讲清后果，取消不写库
    await toggle.click();
    const confirm = page.getByTestId('admin-confirm-action');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      disabling
        ? '停用后新任务不会再使用该渠道，但仍会保留在列表中，可随时重新启用。'
        : '启用后，配置完整的模型会重新进入系统可用模型集合。',
    );
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
  });

  test('线路健康：渠道工作台展示按线路统计的成功率与耗时', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    // 健康面板与「当前状态」是两份数据：面板给过去 24h / 7d 的成功率与 P95
    await expect(page.getByRole('heading', { name: '线路健康' })).toBeVisible();
    await expect(page.getByText('24h 成功率').first()).toBeVisible();
    await expect(page.getByText('7d 成功率').first()).toBeVisible();
    await expect(page.getByText('P95 耗时').first()).toBeVisible();

    // 面板数据来自 /admin/channel-models/health，不是前端自己算的
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const health = await request.get(`${API}/api/v1/admin/channel-models/health`, { headers: auth });
    expect(health.ok()).toBeTruthy();
    const items = ((await health.json())?.data?.items ?? []) as Array<any>;
    if (items.length === 0) {
      // 没有可观测线路时面板给空态，不是空白
      await expect(page.getByText(/没有可观测的线路/).first()).toBeVisible();
      return;
    }
    // 每条线路都有两个窗口，且无样本时成功率是 null（不是 0）
    for (const item of items) {
      expect(item.windows?.day).toBeTruthy();
      expect(item.windows?.week).toBeTruthy();
      expect(item.windows.day.successRate === null || typeof item.windows.day.successRate === 'number').toBeTruthy();
    }
  });

  test('统一调价：勾选模型 → 按成本算价 → 保存售价', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    /*
     * 表头可见不代表数据到了：列表是异步拉的。刚进页面就数行数会数到 0，
     * 误判成「库里没有渠道」而整段跳过 —— 必须等第一行真的出现。
     */
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    /*
     * 调价要求「已启用规格的成本价与售价都已配置」。库里没有这样的规格时
     * 整段跳过 —— 那是配置缺口，不是功能缺陷（后端会明确拒掉并说明原因）。
     * 先用 API 找出第一条「可调价」的渠道与模型，界面步骤再照着它走。
     */
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const channels = (
      (await (await request.get(`${API}/api/v1/admin/channels?limit=100`, { headers: auth })).json())
        ?.data?.channels ?? []
    ) as Array<{ id: string; name: string }>;

    let target: {
      channelId: string;
      channelName: string;
      modelKey: string;
      sale: number;
      tier: { unitPriceMicrocredits: number; costPricing: { unitPriceMicrocredits: number } };
    } | null = null;
    for (const channel of channels) {
      const models = (
        (await (await request.get(`${API}/api/v1/admin/channels/${channel.id}/models`, { headers: auth })).json())
          ?.data ?? []
      ) as Array<any>;
      const model = models.find((item: any) =>
        (item.priceTiers ?? []).some(
          (tier: any) => tier.enabled && tier.priceConfigured && tier.costPricing?.configured,
        ),
      );
      if (!model) continue;
      const tier = model.priceTiers.find(
        (item: any) => item.enabled && item.priceConfigured && item.costPricing?.configured,
      );
      target = {
        channelId: channel.id,
        channelName: channel.name,
        modelKey: model.modelKey,
        sale: tier.unitPriceMicrocredits,
        tier: {
          unitPriceMicrocredits: tier.unitPriceMicrocredits,
          costPricing: { unitPriceMicrocredits: tier.costPricing.unitPriceMicrocredits },
        },
      };
      break;
    }
    if (!target) {
      test.skip(true, '当前库没有「已启用 + 成本价与售价都已配置」的规格；统一调价需要完整价格配置');
    }

    // 选中目标渠道：模型清单在右侧详情区内联渲染
    await channelItems(page).filter({ hasText: target!.channelName }).first().click();
    await expect(page.locator('#admin-channel-detail')).toContainText(target!.channelName);

    // 勾选目标模型（复选框的可访问名是「选择模型 {modelKey}」）
    // 勾选框的可视元素会挡住指针，这里用键盘操作，也更贴近无障碍真实路径。
    const modelCheckbox = page.getByRole('checkbox', { name: `选择模型 ${target!.modelKey}` });
    await modelCheckbox.focus();
    await page.keyboard.press('Space');
    await expect(modelCheckbox).toBeChecked();
    await page.getByRole('button', { name: /统一调价/ }).click();

    // 调价是弹窗；按 testid 定位，避免与模型编辑弹窗的 role 混在一起
    const dialog = page.getByTestId('admin-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('统一调价');
    await expect(dialog).toContainText('新售价 = 成本价');

    // 未填加价率时没有可提交的变化，保存按钮不可用
    await expect(dialog.getByRole('button', { name: /保存售价/ })).toBeDisabled();

    /*
     * 售价真的变了：新售价 = 成本 × (1 + 加价率)，**不是**原售价 × (1 + 加价率)。
     * 默认保留 2 位小数 → 取整到 10^4 微积分（0.01 积分）的整数倍。
     *
     * 加价率不能写死 10%：用例要可重复跑。上一轮已经把售价改成成本 × 1.1，
     * 这一轮再填 10% 就「没有变化」，保存按钮一直是禁用的 —— 那不是功能坏了，
     * 是用例不幂等。所以按当前售价反推一个**一定不同**的加价率。
     */
    const targetTier = target!.tier;
    const currentSale = targetTier.unitPriceMicrocredits;
    const cost = targetTier.costPricing.unitPriceMicrocredits;
    const quantum = 10 ** 4; // 保留 2 位小数 → 0.01 积分
    const round = (value: number) => Math.round(value / quantum) * quantum;
    // 依次试 10 / 20 / 30 …，取第一个算出来不等于当前售价的加价率
    let markup = 10;
    for (const candidate of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
      if (round((cost * (100 + candidate)) / 100) !== currentSale) {
        markup = candidate;
        break;
      }
    }
    const expected = round((cost * (100 + markup)) / 100);

    // 填加价率 → 按成本重算 → 出现可保存的变化
    await dialog.getByLabel('加价率').fill(String(markup));
    await dialog.getByRole('button', { name: '按成本重算' }).click();

    // 原因必填（高危写操作要留审计）：没填时保存按钮仍不可用
    await expect(dialog.getByRole('button', { name: /保存售价/ })).toBeDisabled();
    await dialog.getByLabel('变更原因').fill(`e2e：统一加价 ${markup}%`);
    await expect(dialog.getByRole('button', { name: /保存售价/ })).toBeEnabled();

    await dialog.getByRole('button', { name: /保存售价/ }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('已保存', { timeout: 15000 });

    const modelsAfter = (
      (await (await request.get(`${API}/api/v1/admin/channels/${target!.channelId}/models`, { headers: auth })).json())
        ?.data ?? []
    ) as Array<any>;
    const after = modelsAfter.find((item: any) => item.modelKey === target!.modelKey);
    const tierAfter = (after?.priceTiers ?? []).find(
      (item: any) => item.enabled && item.priceConfigured && item.costPricing?.configured,
    );
    expect(tierAfter, '调价后应能读到价格档').toBeTruthy();
    expect(tierAfter.unitPriceMicrocredits).toBe(expected);
  });

  test('前台模型：清单与路由模拟', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/logical-models`);
    await expect(page.getByRole('heading', { name: '前台模型' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '模型清单' })).toBeVisible();

    // 同样是异步列表：等第一行真的出现再决定要不要跳过
    await expect
      .poll(async () => rows(page).count(), { timeout: 15000, message: '前台模型列表应至少有一行' })
      .toBeGreaterThan(0);

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
    await expect(page.getByRole('heading', { name: '插件', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: '插件清单' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 15000 });
    // 110 个内置插件随包入库，清单不可能为空
    await expect(page.getByText('插件总数').first()).toBeVisible();

    // 「当前环境」列：不允许「插件列在那里但就是不工作」这种静默缺失
    await expect(page.getByText('当前环境').first()).toBeVisible();
    await expect(page.getByText('当前环境不可用').first()).toBeVisible();
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

  test('渠道排序：弹窗可开合、顺序变了才允许保存', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    // 库里有渠道才谈得上排序
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const orderRes = await request.get(`${API}/api/v1/admin/channels/order`, { headers: auth });
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()).data as Array<{ id: string; name: string }>;
    if (order.length === 0) {
      test.skip(true, '当前库没有渠道，排序弹窗无条目可排');
    }

    // 排序入口跟着参考实现落到左列底部（页头只留视图切换）
    await page.getByRole('button', { name: '调整渠道顺序' }).click();
    const dialog = page.getByTestId('admin-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('调整渠道顺序');
    // 排序是全局的：条目数必须等于接口给的条数，不受列表筛选/分页影响
    await expect(dialog.getByRole('listitem')).toHaveCount(order.length);

    // 顺序没动时保存按钮不可用（没有可提交的变化）
    await expect(dialog.getByRole('button', { name: '保存排序' })).toBeDisabled();

    // 上移第一项 → 产生变化 → 保存解禁
    const first = dialog.getByRole('listitem').first();
    const firstName = (await first.innerText()).split('\n').map((s) => s.trim()).filter(Boolean)[1] ?? '';
    await first.getByRole('button', { name: `下移 ${firstName}` }).click();
    await expect(dialog.getByRole('button', { name: '保存排序' })).toBeEnabled();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('排序保存带并发保护：expectedIds 与库中不一致时整单拒绝', async ({ page, request }) => {
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const orderRes = await request.get(`${API}/api/v1/admin/channels/order`, { headers: auth });
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()).data as Array<{ id: string }>;
    if (order.length === 0) {
      test.skip(true, '当前库没有渠道，排序 CAS 无从验证');
    }

    /*
     * expectedIds 必须是「读到的原顺序」。这里故意传一个错位序列：
     * 后端比对库里的当前顺序，不一致就整单拒绝（HTTP 409），而不是
     * 静默覆盖 —— 两个管理员同时排序时，后者必须被拦下。
     */
    const ids = order.map((item) => item.id);
    const wrongExpected = [ids[1], ids[0], ...ids.slice(2)];
    const res = await request.put(`${API}/api/v1/admin/channels/order`, {
      headers: auth,
      data: { ids, expectedIds: wrongExpected },
    });
    expect(res.status(), `错位 expectedIds 必须被拒绝：${await res.text()}`).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(40900);
    expect(body.message).toContain('排序列表已变化');

    // 正确 expectedIds 才能保存成功
    const okRes = await request.put(`${API}/api/v1/admin/channels/order`, {
      headers: auth,
      data: { ids, expectedIds: ids },
    });
    expect(okRes.ok(), await okRes.text()).toBeTruthy();
    expect((await okRes.json()).data.ok).toBe(true);
  });

  test('模型详情区：排序弹窗与批量删除入口按权限/勾选状态给出', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    // 找一个**有模型**的渠道：没有模型的渠道详情区只有空态，测不了排序
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const channels = (
      (await (await request.get(`${API}/api/v1/admin/channels?limit=100`, { headers: auth })).json())
        ?.data?.channels ?? []
    ) as Array<{ id: string; name: string }>;
    let target: { id: string; name: string } | null = null;
    for (const channel of channels) {
      const models = (
        (await (await request.get(`${API}/api/v1/admin/channels/${channel.id}/models`, { headers: auth })).json())
          ?.data ?? []
      ) as Array<any>;
      if (models.length > 0) {
        target = { id: channel.id, name: channel.name };
        break;
      }
    }
    if (!target) {
      test.skip(true, '当前库没有「带模型的渠道」，详情区内的排序/批量删除无从验证');
    }

    await channelItems(page).filter({ hasText: target!.name }).first().click();
    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(target!.name);

    // 排序入口常驻；批量删除/统一调价在未勾选时禁用
    await expect(detail.getByRole('button', { name: '排序', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: '批量删除', exact: true })).toBeDisabled();
    await expect(detail.getByRole('button', { name: '统一调价', exact: true })).toBeDisabled();

    // 勾选一个模型后，批量删除与统一调价解禁并带上计数
    const checkbox = detail.getByRole('checkbox').first();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(detail.getByRole('button', { name: /批量删除（\d+）/ })).toBeEnabled();

    // 批量删除是高危动作：必须先填原因才能确认
    await detail.getByRole('button', { name: /批量删除（\d+）/ }).click();
    const confirm = page.getByTestId('admin-confirm-action');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('影响范围');
    // 原因没填时确认按钮禁用（删除是高危写操作，审计要能回答「谁为什么删」）
    await expect(confirm.getByRole('button', { name: '确认' })).toBeDisabled();
    await confirm.getByLabel('批量删除原因').fill('e2e：批量删除原因校验');
    await expect(confirm.getByRole('button', { name: '确认' })).toBeEnabled();
    // 不点确认：确认对话框，避免动生产数据
    await confirm.getByRole('button', { name: '关闭' }).click();
    await expect(confirm).toHaveCount(0);

    // 模型排序弹窗与详情区平级渲染（两个 React Aria 模态嵌套会互相抢焦点）
    await detail.getByRole('button', { name: '排序', exact: true }).click();
    const orderDialog = page.getByTestId('admin-modal');
    await expect(orderDialog).toBeVisible();
    await expect(orderDialog).toContainText('自定义模型排序');
    await orderDialog.getByRole('button', { name: '取消' }).click();
    await expect(orderDialog).toHaveCount(0);
  });

  test('模型清单：筛选与检索、复制预填、停用需确认', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const channels = (
      (await (await request.get(`${API}/api/v1/admin/channels?limit=100`, { headers: auth })).json())
        ?.data?.channels ?? []
    ) as Array<{ id: string; name: string }>;
    let target: { id: string; name: string } | null = null;
    let models: Array<{ modelKey: string; enabled: boolean; protocol: string }> = [];
    for (const channel of channels) {
      const list = (
        (await (await request.get(`${API}/api/v1/admin/channels/${channel.id}/models`, { headers: auth })).json())
          ?.data ?? []
      ) as Array<{ modelKey: string; enabled: boolean; protocol: string }>;
      if (list.length > 0) {
        target = { id: channel.id, name: channel.name };
        models = list;
        break;
      }
    }
    if (!target) {
      test.skip(true, '当前库没有「带模型的渠道」，清单筛选/复制/停用确认无从验证');
    }

    await channelItems(page).filter({ hasText: target!.name }).first().click();
    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(target!.name);
    const modelRows = () => detail.getByTestId('admin-table-row');
    await expect.poll(async () => modelRows().count(), { timeout: 10000 }).toBeGreaterThan(0);

    // 渠道内也带 24h 稳定性：与「全部模型」同源，排障不必来回切视图
    await expect(detail).toContainText('稳定性（24h）');

    // 检索：无命中时给「没有匹配的模型」，不是空白
    await detail.getByLabel('搜索模型').fill('__e2e_no_such_model__');
    await expect(detail.getByText('没有匹配的模型')).toBeVisible();
    await expect(modelRows()).toHaveCount(0);
    await detail.getByLabel('搜索模型').fill('');
    await expect.poll(async () => modelRows().count(), { timeout: 10000 }).toBeGreaterThan(0);

    // 状态筛选：停用项计数来自与列表同一份数据（分页后总数仍在页脚）
    const disabledCount = models.filter((item) => !item.enabled).length;
    await detail.getByRole('button', { name: '模型状态' }).click();
    await page.getByRole('option', { name: '已停用', exact: true }).click();
    if (disabledCount > 0) {
      await expect(detail.getByText(`共 ${disabledCount} 个模型`)).toBeVisible();
    } else {
      await expect(detail.getByText('没有匹配的模型')).toBeVisible();
    }
    await detail.getByRole('button', { name: '重置' }).click();
    await expect.poll(async () => modelRows().count(), { timeout: 10000 }).toBeGreaterThan(0);

    // 复制：新标识带 -copy 后缀，且默认停用（半配置的副本不许直接进路由）
    const first = models[0];
    await detail.getByRole('button', { name: `复制模型 ${first.modelKey}` }).click();
    const modal = page.getByTestId('admin-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('模型标识')).toHaveValue(`${first.modelKey}-copy`);
    await expect(modal.getByRole('switch', { name: '启用该模型' })).not.toBeChecked();
    // 不保存：弹窗只是预填，落库会污染后续用例的线路数
    await modal.getByRole('button', { name: '取消' }).click();
    await expect(modal).toHaveCount(0);

    // 停用会把模型从路由目录里拿掉：点击后先出确认，不直接断电
    if (models.some((item) => item.enabled)) {
      await detail.getByRole('button', { name: /^停用模型 / }).first().click();
      const confirm = page.getByTestId('admin-confirm-action');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('影响范围');
      await confirm.getByRole('button', { name: '关闭' }).click();
      await expect(confirm).toHaveCount(0);
    }
  });

  test('上游目录导入：弹窗内搜索、已存在标记与只导入新模型', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const channels = (
      (await (await request.get(`${API}/api/v1/admin/channels?limit=100`, { headers: auth })).json())
        ?.data?.channels ?? []
    ) as Array<{ id: string; name: string }>;
    const channel = channels.find((item) => item.name.includes('验收渠道')) ?? channels[0];
    if (!channel) {
      test.skip(true, '当前库没有渠道，上游目录导入无从验证');
    }
    const localModels = (
      (await (await request.get(`${API}/api/v1/admin/channels/${channel!.id}/models`, { headers: auth })).json())
        ?.data ?? []
    ) as Array<{ modelKey: string }>;
    if (localModels.length === 0) {
      test.skip(true, '当前库没有「带模型的渠道」，上游目录导入无从验证');
    }
    const existingKey = localModels[0].modelKey;

    // 上游目录由服务端用库内凭证拉取，这里桩一份固定目录：
    // 一个本地已存在的模型 + 两个新模型，够验证「已存在标记」与「只导入新模型」
    await page.route('**/api/v1/admin/channels/*/models/fetch', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: '',
          data: {
            models: [
              { id: existingKey, displayName: '已存在模型', modelType: 'image' },
              { id: '__e2e_new_a__', displayName: '新模型 A', modelType: 'image' },
              { id: '__e2e_new_b__', displayName: '新模型 B', modelType: 'image' },
            ],
          },
        }),
      }),
    );

    await channelItems(page).filter({ hasText: channel!.name }).first().click();
    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(channel!.name);

    await detail.getByRole('button', { name: '拉取上游目录' }).click();
    const modal = page.getByTestId('admin-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('选择要导入的模型')).toBeVisible();

    // 已存在的模型默认不勾选，且行上有「已存在」标记
    await expect(modal.getByText('已存在').first()).toBeVisible();
    await expect(
      modal.getByRole('checkbox', { name: `选择上游模型 ${existingKey}` }),
    ).not.toBeChecked();
    await expect(modal.getByRole('checkbox', { name: '选择上游模型 __e2e_new_a__' })).toBeChecked();

    // 导入按钮只数新模型
    await expect(modal.getByRole('button', { name: '导入 2 个新模型' })).toBeEnabled();

    // 搜索后只剩匹配项；「取消选中匹配的」只作用于匹配项
    await modal.getByLabel('搜索上游模型').fill('__e2e_new_b__');
    await expect(modal.getByRole('checkbox', { name: '选择上游模型 __e2e_new_a__' })).toHaveCount(0);
    await expect(modal.getByRole('checkbox', { name: '选择上游模型 __e2e_new_b__' })).toBeChecked();
    await modal.getByRole('button', { name: '取消选中匹配的' }).click();
    await expect(modal.getByRole('checkbox', { name: '选择上游模型 __e2e_new_b__' })).not.toBeChecked();
    await expect(modal.getByRole('button', { name: '导入 1 个新模型' })).toBeEnabled();

    // 「全选匹配的」把匹配项加回来
    await modal.getByRole('button', { name: /全选匹配的 1 个/ }).click();
    await expect(modal.getByRole('checkbox', { name: '选择上游模型 __e2e_new_b__' })).toBeChecked();
    await expect(modal.getByRole('button', { name: '导入 2 个新模型' })).toBeEnabled();

    // 不真的导入：落库会污染线路数
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(modal).toHaveCount(0);
  });

  test('全部模型视图：跨渠道列出线路并按状态筛选', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '渠道工作台' })).toBeVisible({ timeout: 20000 });

    // 「按渠道 / 全部模型」是同一份数据的两种组织方式
    await page.getByRole('radio', { name: '全部模型' }).click();
    await expect(page.getByRole('heading', { name: '全部模型' })).toBeVisible();

    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const listRes = await request.get(`${API}/api/v1/admin/channel-models?includeDisabled=1`, {
      headers: auth,
    });
    expect(listRes.ok()).toBeTruthy();
    const all = (await listRes.json()).data as Array<{
      id: string;
      modelKey: string;
      displayName?: string;
      channelName: string;
      enabled: boolean;
      channelEnabled: boolean;
    }>;
    if (all.length === 0) {
      // 没有线路时表格给空态，不是空白
      await expect(page.getByText('还没有渠道模型')).toBeVisible();
      return;
    }

    // 表格行数 = 全部模型数（含停用项）
    // 同页的「线路健康」也是一张表，按容器取行，否则会把它的行数算进来
    const allModelRows = () => page.getByTestId('admin-all-models').getByTestId('admin-table-row');
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(all.length);

    // 「渠道」列必须能落到具体渠道：跨渠道视图不知道一行属于谁等于没看
    await expect(allModelRows().first()).toContainText(all[0].channelName || '—');

    // 计数口径：总条数 + 真正可用的条数（模型与渠道都启用），与参考实现一致
    await expect(
      page.getByTestId('admin-filter').getByText(/^\d+ 个模型 · \d+ 个可用$/),
    ).toBeVisible();

    // 排序：同一模型在不同渠道的行相邻（显示名 → 模型标识 → 渠道名）
    const expectedOrder = [...all].sort(
      (left, right) =>
        (left.displayName || left.modelKey).localeCompare(right.displayName || right.modelKey, 'zh-CN') ||
        left.modelKey.localeCompare(right.modelKey) ||
        (left.channelName || '').localeCompare(right.channelName || '', 'zh-CN'),
    );
    await expect(allModelRows().first()).toContainText(expectedOrder[0].modelKey);

    // 停用筛选只留停用项（模型停用或渠道停用都算停用）
    await page.getByRole('button', { name: '模型状态' }).click();
    await page.getByRole('option', { name: '停用', exact: true }).click();
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(
      all.filter((item) => !item.enabled || !item.channelEnabled).length,
    );

    // 切回全部后恢复
    await page.getByRole('button', { name: '模型状态' }).click();
    await page.getByRole('option', { name: '全部', exact: true }).click();
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(all.length);

    // 停用不是纯展示开关：跨渠道视图同样要二次确认，取消不改库
    await page.getByRole('button', { name: '模型状态' }).click();
    await page.getByRole('option', { name: '启用', exact: true }).click();
    const usable = all.filter((item) => item.enabled && item.channelEnabled);
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(usable.length);
    if (usable.length > 0) {
      await allModelRows().first().getByRole('button', { name: '停用' }).click();
      const confirmDialog = page.getByRole('dialog', { name: /^停用 .+ 的 / });
      await expect(confirmDialog).toContainText('引用它的前台模型会切换到其他可用线路');
      await confirmDialog.getByRole('button', { name: '取消' }).click();
      await expect(confirmDialog).toHaveCount(0);
      await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(usable.length);
    }
    await page.getByRole('button', { name: '模型状态' }).click();
    await page.getByRole('option', { name: '全部', exact: true }).click();
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(all.length);

    // 编辑动线：跨渠道视图直接打开该模型的编辑器，不必先回渠道翻清单
    await allModelRows().first().getByRole('button', { name: '编辑' }).click();
    await expect(page.getByRole('radio', { name: '按渠道' })).toHaveAttribute('aria-checked', 'true');
    const editor = page.getByTestId('admin-modal');
    await expect(editor).toContainText(`编辑模型 · ${expectedOrder[0].modelKey}`);
    await editor.getByRole('button', { name: '取消' }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('radio', { name: '全部模型' }).click();
    await expect(page.getByRole('heading', { name: '全部模型' })).toBeVisible();

    // 排障动线收口：点渠道名一步跳回「按渠道」并选中该渠道，不用自己找
    await allModelRows().first().getByTitle('在渠道中查看').click();
    await expect(page.getByRole('radio', { name: '按渠道' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#admin-channel-detail')).toContainText(all[0].channelName);
  });
});
