import { test, expect, type Page } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

/**
 * 素材管理 + 存储配置 E2E (admin-prd.md §3.4 B-21~27 / §3.11 B-62/63)。
 *
 * 守住三条核心约束:
 *   1. 下架 ≠ 删除 —— 误操作可恢复
 *   2. 已下架素材用户端不可见, 管理端可见
 *   3. 凭据只读: 界面不提供任何写凭据的输入框
 *
 * ## 选择器约定（2026-10-30 换 BoardUI 后）
 *
 * 网格单元 / 批量条 / 存储卡片走 `data-testid="admin-*"`；视图切换、筛选与
 * 行内动作走 `aria-label` 与按钮名。预览灯箱 `ImageLightbox` 是 C 端共用组件，
 * 保留 `img-viewer-*` 类名。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

const cells = (page: Page) => page.getByTestId('admin-asset-cell');
const rows = (page: Page) => page.getByTestId('admin-table-row');

async function login(page: Page) {
  // 侧栏在 ≤1280px 折叠, 分组标题按设计隐藏
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ensureAdminLogin(page);
}

/** 切到表格视图 */
async function toTable(page: Page) {
  await page.getByRole('radio', { name: '表格', exact: true }).click();
  await expect(page.getByTestId('admin-table').first()).toBeVisible({ timeout: 10000 });
}

/** 切回网格视图 */
async function toGrid(page: Page) {
  await page.getByRole('radio', { name: '网格', exact: true }).click();
  await expect(cells(page).first()).toBeVisible({ timeout: 10000 });
}

test.describe('素材管理', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('网格视图渲染缩略图与统计卡', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await expect(page.getByRole('heading', { name: '素材管理' })).toBeVisible({ timeout: 20000 });

    await expect(page.getByText('素材总量').first()).toBeVisible();
    await expect(page.getByText('已下架').first()).toBeVisible();
    await expect(page.getByText('存储分布')).toBeVisible();

    // 网格单元
    await expect(cells(page).first()).toBeVisible({ timeout: 10000 });
    // 缩略图应实际加载出来(不是 broken image)
    const img = cells(page).first().locator('img');
    await expect(img).toBeVisible();
    // 等图片真正 decode 完成再断言 —— naturalWidth 在 decode 前是 0
    await img.evaluate((el) =>
      el.complete ? Promise.resolve() : new Promise((r) => { el.onload = () => r(null); el.onerror = () => r(null); }),
    );
    const naturalW = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(naturalW, '缩略图未加载成功').toBeGreaterThan(0);

    // 网格每页 60 张: 后端 DTO 若丢失分页元数据会静默退回 20, 这里守住页容量
    const totalText = await page.getByText(/^共 \d+ 张$/).first().innerText();
    const total = Number(totalText.match(/\d+/)?.[0] ?? 0);
    expect(await cells(page).count()).toBe(Math.min(total, 60));
  });

  test('B-25 网格与表格视图可切换', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await toTable(page);
    await toGrid(page);
  });

  test('网格勾选后出现批量操作条', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await page.getByRole('checkbox', { name: /^选择 / }).first().check();
    const bulkBar = page.getByTestId('admin-bulk-bar');
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText('已选 1 张素材');
    await expect(bulkBar.getByRole('button', { name: '批量下架' })).toBeVisible();
    await expect(bulkBar.getByRole('button', { name: '批量删除' })).toBeVisible();

    await bulkBar.getByRole('button', { name: '清空选择' }).click();
    await expect(bulkBar).toHaveCount(0);
  });

  test('点击缩略图打开大图预览并支持 Esc 关闭', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await page.getByRole('button', { name: /^查看大图：/ }).first().click();
    const viewer = page.getByRole('dialog', { name: '素材预览' });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.img-viewer-meta')).toContainText(/已上架|已下架/);
    await expect(viewer.locator('.img-viewer-actions')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
  });

  test('桌面 1280 / 1440 / 1920 无横向溢出且无控制台告警', async ({ page }) => {
    const issues: string[] = [];
    page.on('console', (msg) => {
      // 素材可能指向外部存储；单张图请求被重置会由浏览器记一条资源错误，
      // 页面自身已有加载失败占位。这里只守应用 JS / 业务告警，避免外部
      // 网络抖动把布局回归弄红。
      const resourceLoadNoise = msg.text().startsWith('Failed to load resource:');
      if (!resourceLoadNoise && (msg.type() === 'error' || msg.type() === 'warning')) {
        issues.push(`${msg.type()}: ${msg.text()}`);
      }
    });
    page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));

    await login(page);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${UI}/admin/assets`);
      await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });

      const gridMetrics = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        contentW: document.querySelector('.adm-content')?.getBoundingClientRect().width ?? 0,
      }));
      expect(gridMetrics.docW, `${width}px 网格出现页面级横向溢出`).toBeLessThanOrEqual(
        gridMetrics.winW + 1,
      );
      expect(gridMetrics.contentW).toBeGreaterThan(0);

      await toTable(page);
      const tableMetrics = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      }));
      expect(tableMetrics.docW, `${width}px 表格出现页面级横向溢出`).toBeLessThanOrEqual(
        tableMetrics.winW + 1,
      );
    }

    expect(issues).toEqual([]);
  });

  test('表格视图含存储后端列', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await toTable(page);

    const table = page.getByTestId('admin-table').first();
    await expect(table.locator('th', { hasText: '存储' }).first()).toBeVisible();
    await expect(table.locator('td', { hasText: /本地|阿里云 OSS|MinIO/ }).first()).toBeVisible();
  });

  test('筛选: 类型筛选后生成条件回显', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await page.getByRole('button', { name: /按类型筛选/ }).click();
    await page.getByRole('option', { name: '原始上传' }).click();
    await page.getByRole('button', { name: '查询' }).click();

    const chipList = page.getByTestId('admin-filter-chips');
    await expect(chipList).toBeVisible();
    await expect(page.getByTestId('admin-filter-chip')).toHaveCount(1);
    await expect(chipList).toContainText(/原始上传|生成图/);

    await chipList.getByRole('button', { name: '全部清除' }).click();
    await expect(page.getByTestId('admin-filter-chip')).toHaveCount(0);
  });

  test('已下架素材在网格中仍可见且带角标', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await toTable(page);

    const firstRow = rows(page).first();
    await expect(firstRow).toBeVisible();
    const wasHidden = (await firstRow.innerText()).includes('已下架');
    if (!wasHidden) {
      await firstRow.getByRole('button', { name: '下架', exact: true }).click();
      await expect(firstRow).toContainText('已下架', { timeout: 10000 });
    }

    await toGrid(page);
    const firstCell = cells(page).first();
    await expect(firstCell).toHaveAttribute('data-status', 'hidden');
    await expect(firstCell.getByText('已下架', { exact: true })).toBeVisible();

    if (!wasHidden) {
      await toTable(page);
      await rows(page)
        .first()
        .getByRole('button', { name: '恢复', exact: true })
        .click();
      await expect(rows(page).first()).toContainText('已上架', { timeout: 10000 });
    }
  });

  test('下架素材出现角标且可恢复', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await toTable(page);

    const firstRow = rows(page).first();
    const wasHidden = (await firstRow.innerText()).includes('已下架');
    const actionLabel = wasHidden ? '恢复' : '下架';

    await firstRow.getByRole('button', { name: actionLabel, exact: true }).click();
    await page.waitForTimeout(1500);

    const nowHidden = (await rows(page).first().innerText()).includes('已下架');
    expect(nowHidden).toBe(!wasHidden);

    // 恢复原状
    await rows(page)
      .first()
      .getByRole('button', { name: wasHidden ? '下架' : '恢复', exact: true })
      .click();
    await page.waitForTimeout(1200);
  });

  test('删除素材直接执行, 不再弹窗或要求输入确认词', async ({ page }) => {
    let deleteCalls = 0;
    // 拦截真实删除, 避免 e2e 破坏开发库素材
    await page.route('**/api/v1/admin/assets/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deleteCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { id: 'e2e', removedTasks: 0 }, message: '' }),
      });
    });

    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await cells(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await toTable(page);

    await rows(page)
      .first()
      .getByRole('button', { name: '删除', exact: true })
      .click();

    // 没有弹窗、没有确认词输入框，请求直接发出
    await expect(page.getByTestId('admin-modal')).toHaveCount(0);
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
    await expect.poll(() => deleteCalls).toBe(1);
  });
});

test.describe('存储配置', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  const cards = (page: Page) => page.getByTestId('admin-storage-card');

  test('展示各后端状态与凭据来源', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await expect(page.getByRole('heading', { name: '存储配置' })).toBeVisible({ timeout: 20000 });

    // 三个候选后端都要展示 —— 未配置的也要显示, 否则运营不知道它们存在
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).filter({ hasText: '本地磁盘' })).toBeVisible();
    await expect(cards(page).filter({ hasText: '阿里云 OSS' })).toBeVisible();
    await expect(cards(page).filter({ hasText: 'MinIO' })).toBeVisible();
    await expect(page.getByTestId('admin-storage-badge')).toContainText('当前');

    // 未配置的后端应列出启用所需的环境变量 —— 比「未启用」三个字有用
    const ossCard = cards(page).filter({ hasText: '阿里云 OSS' });
    await expect(ossCard.getByTestId('admin-storage-env')).toContainText('OSS_ACCESS_KEY_ID');
  });

  test('B-63 凭据只读: 界面无凭据输入框', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await cards(page).first().waitFor({ state: 'visible', timeout: 20000 });

    // 全页不应有可编辑的凭据输入框
    const inputs = cards(page).locator('input[type="password"], input[type="text"]');
    expect(await inputs.count()).toBe(0);

    // 明确告知凭据来源与不可编辑
    await expect(page.getByText(/凭据不在界面配置/)).toBeVisible();
    await expect(page.getByText(/STORAGE_BACKEND/)).toBeVisible();
  });

  test('连通性测试可用', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await cards(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await page.getByRole('button', { name: '连通性测试' }).first().click();
    // 应出现成功或失败的反馈, 不论结果都说明请求已发出
    await expect(page.getByTestId('admin-toast').first()).toBeVisible({ timeout: 15000 });
  });

  test('当前后端不显示「设为默认」按钮', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await cards(page).first().waitFor({ state: 'visible', timeout: 20000 });

    const activeCard = cards(page).filter({ has: page.getByTestId('admin-storage-badge') });
    await expect(activeCard.getByRole('button', { name: '设为默认' })).toHaveCount(0);
  });
});
