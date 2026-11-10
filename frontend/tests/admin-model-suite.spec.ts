import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';
import {
  createModelSuiteFixture,
  removeModelSuiteFixture,
  type ModelSuiteFixture,
} from './support/model-fixtures';

/**
 * 渠道与模型子系统 P5 验收（`docs/channel-model-design.md` §10）。
 *
 * 覆盖「配置 → 选型 → 报价 → 生成 → 账单核对」整条链路：
 *
 *   1. 后台模型页：模型商品、能力与模型、用户分组、插件、生成账单、调用记录；
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
/** 模型商品「供应商」视图左列的供应商条目（主从布局，不再是表格行） */
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

  let fixture: ModelSuiteFixture | null = null;

  function requireFixture(): ModelSuiteFixture {
    if (!fixture) throw new Error('渠道与模型夹具未初始化');
    return fixture;
  }

  test.beforeAll(async () => {
    if (!HAS_ADMIN_CREDENTIALS) return;
    fixture = await createModelSuiteFixture();
  });

  test.afterAll(async () => {
    if (!HAS_ADMIN_CREDENTIALS) return;
    await removeModelSuiteFixture(fixture);
  });

  test('模型商品：左列供应商导航与右侧内联商品管理', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });

    // 必填校验在提交前拦下：名称 → 服务地址，两次都要给出人话原因
    await page.getByRole('button', { name: '接入供应商' }).first().click();
    await expect(page.getByTestId('admin-drawer')).toBeVisible();
    await page.getByRole('button', { name: '接入', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('请填写供应商名称');

    await page.getByLabel('供应商名称').fill('e2e-未保存渠道');
    await page.getByRole('button', { name: '接入', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('服务地址');

    // 接入供应商没有访问凭证无法调用服务
    await page.getByLabel('服务地址').fill('https://example.com');
    await page.getByRole('button', { name: '接入', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('请填写访问凭证');

    // 高级设置里的附加信息在提交前就拦下，并指出是哪一行
    await page.getByText('高级设置', { exact: true }).click();
    await page.getByRole('button', { name: '添加附加信息' }).click();
    await page.getByLabel('附加信息 1 名称').fill('authorization');
    await page.getByRole('button', { name: '接入', exact: true }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('由系统管理');
    await page.getByRole('button', { name: '删除附加信息 1' }).click();

    // 取消：表单已脏，先弹放弃确认（ConfirmProvider，不是页内 ConfirmDialog）
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible();
    await page.getByRole('button', { name: '放弃修改' }).click();
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);

    /*
     * 模型不再弹抽屉：选中左列渠道后，右侧详情区直接渲染该渠道的商品清单。
     * 选中态落在 `aria-pressed`（辅助技术读得到），右侧标题跟着换成渠道名。
     */
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);
    const first = channelItems(page).first();
    const channelName = await first.getByTestId('admin-channel-name').innerText();
    // 首次进入有渠道的列表时自动选首个，避免右侧停在无意义的空态
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(page.url()).searchParams.get('id')).toBeTruthy();
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');

    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(channelName);
    await expect(detail).toContainText('商品清单');
    // 详情区常驻，不再有承载模型的抽屉
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);

    // 长列表可直接用方向键切换渠道，Home / End 回到首尾
    if ((await channelItems(page).count()) > 1) {
      await first.focus();
      await page.keyboard.press('ArrowDown');
      const second = channelItems(page).nth(1);
      await expect(second).toBeFocused();
      await expect(second).toHaveAttribute('aria-pressed', 'true');

      await page.keyboard.press('Home');
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('供应商详情：编辑 + 更多收敛动作，停用需二次确认', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });

    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);
    await channelItems(page).first().click();

    // 供应商级动作：编辑直显，复制 / 导出 / 启停 / 删除收进「更多」
    const detail = page.locator('#admin-channel-detail');
    await expect(detail.getByRole('button', { name: '编辑供应商', exact: true })).toBeVisible();
    await detail.getByRole('button', { name: /^供应商 .+ 更多操作$/ }).click();
    for (const name of ['复制供应商', '导出配置（不含凭证）', '删除供应商']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    const toggle = page.getByRole('menuitem', { name: /^(停用|启用)供应商$/ });
    await expect(toggle).toBeVisible();
    const disabling = (await toggle.innerText()).trim() === '停用供应商';

    // 停用会让整条供应商退出路由目录：确认弹窗必须讲清后果，取消不写库
    await toggle.click();
    const confirm = page.getByTestId('admin-confirm-action');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      disabling
        ? '停用后新任务不会使用该供应商；配置会保留，可随时重新启用。'
        : '启用后，配置完整的商品会恢复使用。',
    );
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
  });

  test('线路健康：模型商品展示按线路统计的成功率与耗时', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });

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
      await expect(page.getByText('暂无可观测线路').first()).toBeVisible();
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
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });

    /*
     * 表头可见不代表数据到了：列表是异步拉的。刚进页面就数行数会数到 0，
     * 误判成「库里没有渠道」而整段跳过 —— 必须等第一行真的出现。
     */
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    // beforeAll 创建的夹具必须自带一条「已启用 + 成本价/售价齐全」的规格。
    const suite = requireFixture();
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const fixtureModels = (
      (await (await request.get(`${API}/api/v1/admin/channels/${suite.channelId}/models`, { headers: auth })).json())
        ?.data?.models ?? []
    ) as Array<any>;
    const fixtureModel = fixtureModels.find((item: any) => item.modelKey === suite.channelModelKey);
    expect(fixtureModel, '夹具渠道模型未出现在管理员商品清单').toBeTruthy();
    const tier = (fixtureModel.priceTiers ?? []).find(
      (item: any) => item.enabled && item.priceConfigured && item.costPricing?.configured,
    );
    expect(tier, '夹具模型必须同时配置启用中的成本价与售价').toBeTruthy();
    const target = {
      channelId: suite.channelId,
      channelName: suite.channelName,
      modelKey: suite.channelModelKey,
      sale: tier.unitPriceMicrocredits as number,
      tier: {
        unitPriceMicrocredits: tier.unitPriceMicrocredits as number,
        costPricing: { unitPriceMicrocredits: tier.costPricing.unitPriceMicrocredits as number },
      },
    };

    // 选中目标渠道：商品清单在右侧详情区内联渲染
    await channelItems(page).filter({ hasText: target.channelName }).first().click();
    await expect(page.locator('#admin-channel-detail')).toContainText(target.channelName);

    // 勾选目标商品（复选框的可访问名是「选择商品 {modelKey}」）
    // 勾选框的可视元素会挡住指针，这里用键盘操作，也更贴近无障碍真实路径。
    const modelCheckbox = page.getByRole('checkbox', { name: `选择商品 ${target.modelKey}` });
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
    const targetTier = target.tier;
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

    // 页面不再额外要求人工填写变更原因
    await expect(dialog.getByLabel('变更原因')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /保存售价/ })).toBeEnabled();

    await dialog.getByRole('button', { name: /保存售价/ }).click();
    await expect(page.getByTestId('admin-toast').last()).toContainText('已保存', { timeout: 15000 });

    const modelsAfter = (
      (await (await request.get(`${API}/api/v1/admin/channels/${target.channelId}/models`, { headers: auth })).json())
        ?.data?.models ?? []
    ) as Array<any>;
    const after = modelsAfter.find((item: any) => item.modelKey === target.modelKey);
    const tierAfter = (after?.priceTiers ?? []).find(
      (item: any) => item.enabled && item.priceConfigured && item.costPricing?.configured,
    );
    expect(tierAfter, '调价后应能读到价格档').toBeTruthy();
    expect(tierAfter.unitPriceMicrocredits).toBe(expected);
  });

  test('能力消耗价：旧地址重定向到能力页定价标签', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/credit-prices`);
    await expect(page).toHaveURL(`${UI}/admin/capabilities?tab=pricing`);
    await expect(page.getByRole('heading', { name: '能力与模型' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('tab', { name: '能力消耗价' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: '能力消耗价' })).toBeVisible();

    // 两个工作区同时挂载：切到能力页再回来，未保存的定价草稿不能丢。
    const priceInput = page.getByRole('spinbutton', { name: /生效消耗价/ }).first();
    const original = await priceInput.inputValue();
    const draft = original === '0' ? '1' : String(Number(original) + 1);
    await priceInput.fill(draft);
    await page.getByRole('tab', { name: '能力与模型' }).click();
    await expect(page).toHaveURL(`${UI}/admin/capabilities`);
    await expect(page.getByRole('heading', { name: '能力与商品清单' })).toBeVisible();
    await page.getByRole('tab', { name: '能力消耗价' }).click();
    await expect(page).toHaveURL(`${UI}/admin/capabilities?tab=pricing`);
    await expect(priceInput).toHaveValue(draft);

    // 复原草稿后回到默认标签，保持既有 `/admin/capabilities` 深链形态。
    await priceInput.fill(original);
    await page.getByRole('tab', { name: '能力与模型' }).click();
    await expect(page).toHaveURL(`${UI}/admin/capabilities`);
  });

  test('能力与模型：旧地址重定向、清单与消费测试', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/logical-models`);
    await expect(page).toHaveURL(`${UI}/admin/capabilities`);
    await expect(page.getByRole('heading', { name: '能力与模型' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('heading', { name: '能力与商品清单' })).toBeVisible();

    // 同样是异步列表：等第一行真的出现再决定要不要跳过
    await expect
      .poll(async () => rows(page).count(), { timeout: 15000, message: '前台模型列表应至少有一行' })
      .toBeGreaterThan(0);

    await rows(page).first().getByRole('button', { name: '测试消费', exact: true }).click();
    await expect(page.getByTestId('admin-drawer')).toContainText('消费测试 · ');
    await page.getByRole('button', { name: '开始测试' }).click();

    // 消费测试是只读：要么给出候选/选中商品，要么给出「为什么没落」
    await expect(page.getByTestId('admin-drawer')).toContainText('候选商品', { timeout: 15000 });
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

    await expect(page.getByTestId('model-picker-empty')).toHaveCount(0);
    const options = picker.getByTestId('model-option');
    await expect.poll(() => options.count()).toBeGreaterThan(0);

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
    const model = models.find((entry) => entry.id === requireFixture().freeCreateId);
    expect(model, '夹具 free_create 模型未出现在用户模型目录').toBeTruthy();
    expect(model!.capability).toBe('free_create');
    expect(model!.available, '夹具 free_create 模型必须路由到可用线路').toBe(true);

    // 新账号没有积分：由管理员通过积分调整入口发放
    const adjustRes = await request.post(`${API}/api/v1/admin/credits/adjust`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { userId, delta: 200, reason: '端到端测试发放生成额度' },
    });
    expect(adjustRes.ok(), `credit adjust ${adjustRes.status()}: ${await adjustRes.text()}`).toBeTruthy();

    // 报价：同一模型同一参数下，报价必须先于建任务给出确定金额
    const quoteRes = await request.post(`${API}/api/v1/models/${model!.id}/quote`, {
      headers: auth,
      // 报价 / 选路意图按供应侧模态（image），生成接口仍按产品能力（free_create）
      data: { capability: 'image' },
    });
    const quoteBody = await quoteRes.text();
    expect(quoteRes.ok(), `model quote ${quoteRes.status()}: ${quoteBody}`).toBeTruthy();
    const quote = JSON.parse(quoteBody).data.quote as {
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
        params: { prompt: 'E2E：白色背景的陶瓷杯，商品摄影' },
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
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });

    // 库里有渠道才谈得上排序
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const orderRes = await request.get(`${API}/api/v1/admin/channels/order`, { headers: auth });
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()).data.items as Array<{ id: string; name: string }>;
    expect(order.length, '夹具至少创建两条渠道供排序').toBeGreaterThanOrEqual(2);

    // 排序入口收在左列标题栏，页头只留视图切换
    await page.getByRole('button', { name: '调整供应商顺序' }).click();
    const dialog = page.getByTestId('admin-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('调整供应商顺序');
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
    const order = (await orderRes.json()).data.items as Array<{ id: string }>;
    expect(order.length, '夹具至少创建两条渠道供排序 CAS').toBeGreaterThanOrEqual(2);

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

  test('商品详情区：排序弹窗与批量删除入口按勾选状态给出', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    const target = requireFixture();

    await channelItems(page).filter({ hasText: target.channelName }).first().click();
    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(target.channelName);
    await expect(
      detail.getByTestId('admin-table-row').filter({ hasText: target.channelModelKey }),
    ).toBeVisible();

    // 排序入口常驻；批量删除/统一调价在未勾选时禁用
    await expect(detail.getByRole('button', { name: '排序', exact: true })).toBeVisible();
    // 批量动作只在勾选后出现，未勾选时不占首屏
    await expect(detail.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '统一调价', exact: true })).toHaveCount(0);

    // 勾选一个商品后，批量删除与统一调价出现并带上计数
    const checkbox = detail.getByRole('checkbox').first();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(detail.getByRole('button', { name: /批量删除（\d+）/ })).toBeEnabled();

    // 批量删除是高危动作，但页面不再额外要求人工填写原因
    await detail.getByRole('button', { name: /批量删除（\d+）/ }).click();
    const confirm = page.getByTestId('admin-confirm-action');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('影响范围');
    await expect(confirm.getByLabel('批量删除原因')).toHaveCount(0);
    await expect(confirm.getByRole('button', { name: '确认删除' })).toBeEnabled();
    // 不点确认：确认对话框，避免动生产数据
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(confirm).toHaveCount(0);

    // 商品排序弹窗与详情区平级渲染（两个 React Aria 模态嵌套会互相抢焦点）
    await detail.getByRole('button', { name: '排序', exact: true }).click();
    const orderDialog = page.getByTestId('admin-modal');
    await expect(orderDialog).toBeVisible();
    await expect(orderDialog).toContainText('自定义商品排序');
    await orderDialog.getByRole('button', { name: '取消' }).click();
    await expect(orderDialog).toHaveCount(0);
  });

  test('商品清单：筛选与检索、复制预填、停用需确认', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    const target = requireFixture();
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const models = (
      (await (await request.get(`${API}/api/v1/admin/channels/${target.channelId}/models`, { headers: auth })).json())
        ?.data?.models ?? []
    ) as Array<{ modelKey: string; enabled: boolean; protocol: string; capability: string }>;
    expect(models.length, '夹具渠道必须包含模型').toBeGreaterThan(0);

    await channelItems(page).filter({ hasText: target.channelName }).first().click();
    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(target.channelName);
    const modelRows = () => detail.getByTestId('admin-table-row');
    await expect.poll(async () => modelRows().count(), { timeout: 10000 }).toBeGreaterThan(0);

    // 供应商内也带 24h 健康：与「商品台账」同源，排障不必来回切视图
    await expect(detail).toContainText('健康');

    // 检索：无命中时给「没有匹配的商品」，不是空白
    await detail.getByLabel('搜索商品').fill('__e2e_no_such_model__');
    await expect(detail.getByText('没有匹配的商品')).toBeVisible();
    await expect(modelRows()).toHaveCount(0);
    await detail.getByLabel('搜索商品').fill('');
    await expect.poll(async () => modelRows().count(), { timeout: 10000 }).toBeGreaterThan(0);

    // 状态筛选：停用项计数来自与列表同一份数据（分页后总数仍在页脚）
    const disabledCount = models.filter((item) => !item.enabled).length;
    await detail.getByRole('combobox', { name: '商品状态' }).click();
    await page.getByRole('option', { name: '已停用', exact: true }).click();
    if (disabledCount > 0) {
      await expect(detail.getByText(`共 ${disabledCount} 个商品`)).toBeVisible();
    } else {
      await expect(detail.getByText('没有匹配的商品')).toBeVisible();
    }
    await detail.getByRole('button', { name: '重置' }).click();
    await expect.poll(async () => modelRows().count(), { timeout: 10000 }).toBeGreaterThan(0);

    // 复制：新标识带 -copy 后缀，且默认停用（半配置的副本不许直接进路由）
    const first = models[0];
    const firstRow = modelRows().filter({ hasText: first.modelKey }).first();
    await expect(firstRow.getByRole('button', { name: `编辑商品 ${first.modelKey}` })).toBeVisible();
    const firstMore = firstRow.getByRole('button', { name: `商品 ${first.modelKey} 更多操作` });
    await expect(firstMore).toBeVisible();
    await firstMore.click();
    await expect(page.getByRole('menuitem', { name: '测试连通' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '复制商品' })).toBeVisible();
    await page.getByRole('menuitem', { name: '复制商品' }).click();
    const modal = page.getByTestId('admin-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('商品编号')).toHaveValue(`${first.modelKey}-copy`);
    await expect(modal.getByRole('switch', { name: '启用该商品' })).not.toBeChecked();
    // 表单分层后默认内容可在一屏内读完，不再断言必然出现滚动条
    await expect(modal.getByTestId('admin-modal-body')).toBeVisible();
    await expect(modal.getByRole('button', { name: '保存商品' })).toBeVisible();
    // Footer 的保存按钮在 form 外，靠 form 属性提交；空商品编号应留在弹窗内做字段级提示
    await modal.getByLabel('商品编号').fill('');
    await modal.getByRole('button', { name: '保存商品' }).click();
    await expect(modal.getByText('请填写商品编号')).toBeVisible();
    // 能力参数默认收在高级区，展开后再核对内容
    await modal.getByText('高级：能力参数', { exact: true }).click();
    if (first.capability === 'image') {
      await expect(modal.getByRole('heading', { name: '图片能力参数' })).toBeVisible();
      await expect(modal.getByLabel('提示词最大字符数')).toBeVisible();
      await expect(modal.getByRole('button', { name: '使用推荐值' })).toBeVisible();
      await expect(modal.getByLabel('能力配置')).toHaveCount(0);
    } else {
      const capabilityHeight = await modal
        .getByLabel('能力配置')
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(capabilityHeight).toBeLessThan(260);
    }
    // 不保存：弹窗只是预填，落库会污染后续用例的线路数
    await modal.getByRole('button', { name: '取消' }).click();
    await expect(modal).toHaveCount(0);

    // 停用会把模型从路由目录里拿掉：点击后先出确认，不直接断电
    const enabledModel = models.find((item) => item.enabled);
    if (enabledModel) {
      const enabledRow = modelRows().filter({ hasText: enabledModel.modelKey }).first();
      await enabledRow
        .getByRole('button', { name: `商品 ${enabledModel.modelKey} 更多操作` })
        .click();
      await page.getByRole('menuitem', { name: '停用商品' }).click();
      const confirm = page.getByTestId('admin-confirm-action');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('影响范围');
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      await expect(confirm).toHaveCount(0);
    }

    // 删除从行内「更多」进入；确认弹窗出现时必须立即可见
    await firstRow.getByRole('button', { name: `商品 ${first.modelKey} 更多操作` }).click();
    await page.getByRole('menuitem', { name: '删除商品' }).click();
    const deleteConfirm = page.getByTestId('admin-confirm-action');
    await expect(deleteConfirm).toBeVisible();
    await expect(deleteConfirm).toContainText(`删除商品 ${first.modelKey}`);
    await deleteConfirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(deleteConfirm).toHaveCount(0);
  });

  test('上游目录导入：弹窗内搜索、已存在标记与只导入新商品', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels?view=channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => channelItems(page).count(), { timeout: 15000, message: '左列至少有一个渠道' })
      .toBeGreaterThan(0);

    const channel = requireFixture();
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const localModels = (
      (await (await request.get(`${API}/api/v1/admin/channels/${channel.channelId}/models`, { headers: auth })).json())
        ?.data?.models ?? []
    ) as Array<{ modelKey: string }>;
    expect(localModels.length, '夹具渠道必须包含模型').toBeGreaterThan(0);
    const existingKey = localModels.find((item) => item.modelKey === channel.channelModelKey)?.modelKey;
    expect(existingKey, '夹具渠道模型未出现在管理员商品清单').toBeTruthy();

    // 上游目录由服务端用库内凭证拉取，这里桩一份固定目录：
    // 一个本地已存在的商品 + 两个新商品，够验证「已存在标记」与「只导入新商品」
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

    await channelItems(page).filter({ hasText: channel.channelName }).first().click();
    const detail = page.locator('#admin-channel-detail');
    await expect(detail).toContainText(channel.channelName);

    await detail.getByRole('button', { name: '从供应商同步商品' }).click();
    const modal = page.getByTestId('admin-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('导入供应商商品')).toBeVisible();

    // 已存在的模型默认不勾选，且行上有「已存在」标记
    await expect(modal.getByText('已存在').first()).toBeVisible();
    await expect(
      modal.getByRole('checkbox', { name: `选择供应商商品 ${existingKey}` }),
    ).not.toBeChecked();
    await expect(modal.getByRole('checkbox', { name: '选择供应商商品 __e2e_new_a__' })).toBeChecked();

    // 导入按钮只数新模型
    await expect(modal.getByRole('button', { name: '导入 2 个新商品' })).toBeEnabled();

    // 搜索后只剩匹配项；「取消选中匹配的」只作用于匹配项
    await modal.getByLabel('搜索供应商商品').fill('__e2e_new_b__');
    await expect(modal.getByRole('checkbox', { name: '选择供应商商品 __e2e_new_a__' })).toHaveCount(0);
    await expect(modal.getByRole('checkbox', { name: '选择供应商商品 __e2e_new_b__' })).toBeChecked();
    await modal.getByRole('button', { name: '取消选中匹配的' }).click();
    await expect(modal.getByRole('checkbox', { name: '选择供应商商品 __e2e_new_b__' })).not.toBeChecked();
    await expect(modal.getByRole('button', { name: '导入 1 个新商品' })).toBeEnabled();

    // 「全选匹配的」把匹配项加回来
    await modal.getByRole('button', { name: /全选匹配的 1 个/ }).click();
    await expect(modal.getByRole('checkbox', { name: '选择供应商商品 __e2e_new_b__' })).toBeChecked();
    await expect(modal.getByRole('button', { name: '导入 2 个新商品' })).toBeEnabled();

    // 不真的导入：落库会污染线路数
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(modal).toHaveCount(0);
  });

  test('商品台账：跨供应商列出商品并按状态筛选', async ({ page, request }) => {
    await login(page);
    await page.goto(`${UI}/admin/channels`);
    await expect(page.getByRole('heading', { name: '模型商品' })).toBeVisible({ timeout: 20000 });

    // 商品台账是默认视图；同一份数据可切到「供应商」组织
    await expect(page.getByRole('heading', { name: '商品台账' })).toBeVisible();

    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const listRes = await request.get(`${API}/api/v1/admin/channel-models?includeDisabled=1`, {
      headers: auth,
    });
    expect(listRes.ok()).toBeTruthy();
    const all = (await listRes.json()).data.models as Array<{
      id: string;
      modelKey: string;
      displayName?: string;
      channelName: string;
      enabled: boolean;
      channelEnabled: boolean;
    }>;
    if (all.length === 0) {
      // 没有线路时表格给空态，不是空白
      await expect(page.getByText('暂无商品')).toBeVisible();
      return;
    }

    // 表格行数 = 全部商品数（含停用项）
    // 同页的「线路健康」也是一张表，按容器取行，否则会把它的行数算进来
    const allModelRows = () => page.getByTestId('admin-all-models').getByTestId('admin-table-row');
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(all.length);

    // 排序：同一模型在不同渠道的行相邻（展示名称 → 商品编号 → 渠道名）
    const expectedOrder = [...all].sort(
      (left, right) =>
        (left.displayName || left.modelKey).localeCompare(right.displayName || right.modelKey, 'zh-CN') ||
        left.modelKey.localeCompare(right.modelKey) ||
        (left.channelName || '').localeCompare(right.channelName || '', 'zh-CN'),
    );

    // 「渠道」列必须能落到具体渠道：跨渠道视图不知道一行属于谁等于没看
    await expect(allModelRows().first()).toContainText(expectedOrder[0].channelName || '—');

    // 计数口径：总条数 + 真正可用的条数（模型与渠道都启用），与参考实现一致
    await expect(
      page.getByTestId('admin-filter').getByText(/^\d+ 个商品 · \d+ 个可用$/),
    ).toBeVisible();

    await expect(allModelRows().first()).toContainText(expectedOrder[0].modelKey);

    // 停用筛选只留停用项（已停用或渠道停用都算停用）
    await page.getByRole('combobox', { name: '商品状态' }).click();
    await page.getByRole('option', { name: '已停用', exact: true }).click();
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(
      all.filter((item) => !item.enabled || !item.channelEnabled).length,
    );

    // 切回全部后恢复
    await page.getByRole('combobox', { name: '商品状态' }).click();
    await page.getByRole('option', { name: '全部', exact: true }).click();
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(all.length);

    // 停用不是纯展示开关：商品台账同样要二次确认，取消不改库
    await page.getByRole('combobox', { name: '商品状态' }).click();
    await page.getByRole('option', { name: '可用', exact: true }).click();
    const usable = all.filter((item) => item.enabled && item.channelEnabled);
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(usable.length);
    if (usable.length > 0) {
      await allModelRows().first().getByRole('button', { name: '停用商品' }).click();
      const confirmDialog = page.getByRole('dialog', { name: /^停用 .+ 的 / });
      await expect(confirmDialog).toContainText('消费它的能力会切换到其他可用商品');
      await confirmDialog.getByRole('button', { name: '取消' }).click();
      await expect(confirmDialog).toHaveCount(0);
      await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(usable.length);
    }
    await page.getByRole('combobox', { name: '商品状态' }).click();
    await page.getByRole('option', { name: '全部', exact: true }).click();
    await expect.poll(async () => allModelRows().count(), { timeout: 15000 }).toBe(all.length);

    // 编辑动线：商品台账直接打开该商品的编辑器，不必先回供应商翻清单
    await allModelRows().first().getByRole('button', { name: '编辑' }).click();
    await expect(page.getByRole('radio', { name: '供应商' })).toHaveAttribute('aria-checked', 'true');
    const editor = page.getByTestId('admin-modal');
    await expect(editor).toContainText(`编辑商品 · ${expectedOrder[0].modelKey}`);
    await editor.getByRole('button', { name: '取消' }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('radio', { name: '商品台账' }).click();
    await expect(page.getByRole('heading', { name: '商品台账' })).toBeVisible();

    // 排障动线收口：点供应商名一步跳回「供应商」并选中该供应商，不用自己找
    await allModelRows().first().getByTitle('在供应商中查看').click();
    await expect(page.getByRole('radio', { name: '供应商' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#admin-channel-detail')).toContainText(expectedOrder[0].channelName);
  });
});
