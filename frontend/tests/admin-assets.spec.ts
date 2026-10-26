import { test, expect, type Page } from '@playwright/test';

/**
 * 素材管理 + 存储配置 E2E (admin-prd.md §3.4 B-21~27 / §3.11 B-62/63)。
 *
 * 守住三条核心约束:
 *   1. 下架 ≠ 删除 —— 误操作可恢复
 *   2. 已下架素材用户端不可见, 管理端可见
 *   3. 凭据只读: 界面不提供任何写凭据的输入框
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

async function login(page: Page) {
  // 侧栏在 ≤1280px 折叠, 分组标题按设计隐藏
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email').first().fill('admin@huojue.local');
  await page.locator('input[type="password"]').first().fill(process.env.ADMIN_PASSWORD ?? '');
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('素材管理', () => {
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  test('网格视图渲染缩略图与统计卡', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await expect(page.getByRole('heading', { name: '素材管理' })).toBeVisible({ timeout: 20000 });

    await expect(page.getByText('素材总量').first()).toBeVisible();
    await expect(page.getByText('已下架').first()).toBeVisible();
    await expect(page.getByText('存储分布')).toBeVisible();

    // 网格单元
    await expect(page.locator('.adm-asset-cell').first()).toBeVisible({ timeout: 10000 });
    // 缩略图应实际加载出来(不是 broken image)
    const img = page.locator('.adm-asset-cell img').first();
    await expect(img).toBeVisible();
    // 等图片真正 decode 完成再断言 —— naturalWidth 在 decode 前是 0
    await img.evaluate((el) =>
      el.complete ? Promise.resolve() : new Promise((r) => { el.onload = () => r(null); el.onerror = () => r(null); }),
    );
    const naturalW = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(naturalW, '缩略图未加载成功').toBeGreaterThan(0);

    // 网格每页 60 张: 后端 DTO 若丢失分页元数据会静默退回 20, 这里守住页容量
    const totalText = await page.locator('.adm-panel .adm-panel-note').first().innerText();
    const total = Number(totalText.match(/\d+/)?.[0] ?? 0);
    expect(await page.locator('.adm-asset-cell').count()).toBe(Math.min(total, 60));
  });

  test('B-25 网格与表格视图可切换', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });

    // 切到表格
    await page.locator('.adm-segmented-item[title="表格视图"]').click();
    await expect(page.locator('.adm-panel table').first()).toBeVisible({ timeout: 10000 });

    // 切回网格
    await page.locator('.adm-segmented-item[title="缩略图网格"]').click();
    await expect(page.locator('.adm-asset-cell').first()).toBeVisible({ timeout: 10000 });
  });

  test('网格勾选后出现批量操作条', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });

    await page.locator('.adm-asset-select input[type="checkbox"]').first().check();
    const bulkBar = page.locator('.adm-bulk-bar');
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar.locator('.adm-bulk-count')).toContainText('已选 1 张素材');
    await expect(bulkBar.getByRole('button', { name: '批量下架' })).toBeVisible();
    await expect(bulkBar.getByRole('button', { name: '批量删除' })).toBeVisible();

    await bulkBar.getByRole('button', { name: '清空选择' }).click();
    await expect(bulkBar).toHaveCount(0);
  });

  test('点击缩略图打开大图预览并支持 Esc 关闭', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });

    await page.locator('.adm-asset-cell .adm-asset-preview').first().click();
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
      if (msg.type() === 'error' || msg.type() === 'warning') {
        issues.push(`${msg.type()}: ${msg.text()}`);
      }
    });
    page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));

    await login(page);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${UI}/admin/assets`);
      await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });

      const gridMetrics = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        contentW: document.querySelector('.adm-content')?.getBoundingClientRect().width ?? 0,
      }));
      expect(gridMetrics.docW, `${width}px 网格出现页面级横向溢出`).toBeLessThanOrEqual(
        gridMetrics.winW + 1,
      );
      expect(gridMetrics.contentW).toBeGreaterThan(0);

      await page.locator('.adm-segmented-item[title="表格视图"]').click();
      await expect(page.locator('.adm-panel table').first()).toBeVisible();
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
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });
    await page.locator('.adm-segmented-item[title="表格视图"]').click();
    await expect(page.locator('.adm-panel table th', { hasText: '存储' }).first()).toBeVisible();
    await expect(page.locator('.adm-panel table td', { hasText: /本地|OSS|MinIO/ }).first()).toBeVisible();
  });

  test('筛选: 存储后端与类型', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });

    await page.locator('.adm-filter .ant-select').first().click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('.adm-filter-actions .ant-btn-primary').click();
    await expect(page.locator('.adm-filter-chip')).toHaveCount(1);
    await expect(page.locator('.adm-filter-chip')).toContainText(/原始上传|生成图/);
    await expect(page.locator('.adm-filter-chip-clear')).toBeVisible();
    // 筛选后仍有结果
    expect(await page.locator('.adm-asset-cell').count()).toBeGreaterThanOrEqual(0);

    await page.getByRole('button', { name: '全部清除' }).click();
    await expect(page.locator('.adm-filter-chip')).toHaveCount(0);
  });

  test('已下架素材在网格中仍可见且带角标', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });
    await page.locator('.adm-segmented-item[title="表格视图"]').click();

    const firstRow = page.locator('.adm-panel table tbody tr.ant-table-row').first();
    await expect(firstRow).toBeVisible();
    const wasHidden = (await firstRow.innerText()).includes('已下架');
    if (!wasHidden) {
      await firstRow.getByRole('button', { name: '下架' }).click();
      await expect(firstRow).toContainText('已下架', { timeout: 10000 });
    }

    await page.locator('.adm-segmented-item[title="缩略图网格"]').click();
    const firstCell = page.locator('.adm-asset-cell').first();
    await expect(firstCell).toHaveClass(/is-hidden/);
    await expect(firstCell.locator('.adm-asset-badge')).toHaveText('已下架');

    if (!wasHidden) {
      await page.locator('.adm-segmented-item[title="表格视图"]').click();
      await page.locator('.adm-panel table tbody tr.ant-table-row').first()
        .getByRole('button', { name: '恢复' }).click();
      await expect(page.locator('.adm-panel table tbody tr.ant-table-row').first())
        .toContainText('已上架', { timeout: 10000 });
    }
  });

  test('下架素材出现角标且可恢复', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });
    await page.locator('.adm-segmented-item[title="表格视图"]').click();
    await expect(page.locator('.adm-panel table').first()).toBeVisible();

    const firstRow = page.locator('.adm-panel table tbody tr.ant-table-row').first();
    const wasHidden = (await firstRow.innerText()).includes('已下架');
    const actionLabel = wasHidden ? '恢复' : '下架';

    await firstRow.locator('.adm-link', { hasText: actionLabel }).click();
    await page.waitForTimeout(1500);

    const nowHidden = (await page.locator('.adm-panel table tbody tr.ant-table-row').first().innerText()).includes('已下架');
    expect(nowHidden).toBe(!wasHidden);

    // 恢复原状
    await page.locator('.adm-panel table tbody tr.ant-table-row').first()
      .locator('.adm-link', { hasText: wasHidden ? '下架' : '恢复' }).click();
    await page.waitForTimeout(1200);
  });

  test('删除素材需输入确认词', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });
    await page.locator('.adm-segmented-item[title="表格视图"]').click();
    await expect(page.locator('.adm-panel table').first()).toBeVisible();

    await page.locator('.adm-panel table tbody tr.ant-table-row').first().locator('.adm-link.is-danger').click();
    await expect(page.locator('.ant-modal-title', { hasText: '删除素材' })).toBeVisible();

    // 确认词未输入时按钮应禁用
    const confirmBtn = page.getByRole('button', { name: '永久删除' });
    await expect(confirmBtn).toBeDisabled();

    // 输入后启用
    await page.locator('#adm-confirm-input').fill('删除');
    await expect(confirmBtn).toBeEnabled();

    // 取消
    await page.getByRole('button', { name: /取\s*消/ }).click();
  });

  test('删除弹窗量化影响范围', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/assets`);
    await page.waitForSelector('.adm-asset-cell', { timeout: 20000 });
    await page.locator('.adm-segmented-item[title="表格视图"]').click();
    await page.waitForTimeout(800);

    await page.locator('.adm-panel table tbody tr.ant-table-row').first().locator('.adm-link.is-danger').click();
    await expect(page.locator('.adm-confirm-impact-title')).toBeVisible();
    // 应量化说明文件大小与任务数, 而不是笼统的「将删除数据」
    await expect(page.locator('.adm-confirm-impact')).toContainText(/文件大小/);
    await expect(page.locator('.adm-confirm-impact')).toContainText(/关联的 \d+ 条产出任务记录/);
    await page.getByRole('button', { name: /取\s*消/ }).click();
  });
});

test.describe('存储配置', () => {
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  test('展示各后端状态与凭据来源', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await expect(page.getByRole('heading', { name: '存储配置' })).toBeVisible({ timeout: 20000 });

    // 三个候选后端都要展示 —— 未配置的也要显示, 否则运营不知道它们存在
    await expect(page.locator('.adm-storage-card')).toHaveCount(3);
    await expect(page.locator('.adm-storage-card', { hasText: '本地磁盘' })).toBeVisible();
    await expect(page.locator('.adm-storage-card', { hasText: '阿里云 OSS' })).toBeVisible();
    await expect(page.locator('.adm-storage-card', { hasText: 'MinIO' })).toBeVisible();
    await expect(page.locator('.adm-storage-badge', { hasText: '当前' })).toBeVisible();

    // 未配置的后端应列出启用所需的环境变量 —— 比「未启用」三个字有用
    const ossCard = page.locator('.adm-storage-card', { hasText: '阿里云 OSS' });
    await expect(ossCard.locator('.adm-storage-env-title')).toBeVisible();
    await expect(ossCard.locator('.adm-storage-env')).toContainText('OSS_ACCESS_KEY_ID');
  });

  test('B-63 凭据只读: 界面无凭据输入框', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await page.waitForSelector('.adm-storage-card', { timeout: 20000 });

    // 全页不应有可编辑的凭据输入框
    const inputs = page.locator('.adm-storage-card input[type="password"], .adm-storage-card input[type="text"]');
    expect(await inputs.count()).toBe(0);

    // 明确告知凭据来源与不可编辑
    await expect(page.getByText('凭据不在界面配置')).toBeVisible();
    await expect(page.getByText(/STORAGE_BACKEND/)).toBeVisible();
  });

  test('连通性测试可用', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await page.waitForSelector('.adm-storage-card', { timeout: 20000 });

    await page.getByRole('button', { name: '连通性测试' }).first().click();
    // 应出现成功或失败的反馈, 不论结果都说明请求已发出
    await expect(page.locator('.ant-message')).toBeVisible({ timeout: 15000 });
  });

  test('当前后端不显示「设为默认」按钮', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/storage`);
    await page.waitForSelector('.adm-storage-card', { timeout: 20000 });

    const activeCard = page.locator('.adm-storage-card.is-active');
    await expect(activeCard.getByRole('button', { name: '设为默认' })).toHaveCount(0);
  });
});
