/**
 * 素材库导入弹窗冒烟: 容器几何 / 共享组件行为 / 选择上限 / 空态语义。
 * 组件已换成 ui 兼容层 (Dropdown / Input / Button) 后的回归入口。
 */
import { launchChromium } from './browser.mjs';

const login = await fetch('http://127.0.0.1:4100/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@admin.com', password: '123456789' }),
}).then((r) => r.json());
const token = login.data.accessToken;

const b = await launchChromium({ args: ['--no-proxy-server'] });
const fail = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail.push(msg);
};

async function open(viewport, tok = token) {
  const ctx = await b.newContext({ viewport, locale: 'zh-CN' });
  if (tok) {
    await ctx.addInitScript((t) => {
      localStorage.setItem('huojue_token', t);
      localStorage.setItem('huojue_email', 'admin@admin.com');
    }, tok);
  }
  const p = await ctx.newPage();
  await p.goto('http://localhost:5100/product-kit', { waitUntil: 'networkidle' });
  await p.getByText('从素材库导入', { exact: true }).first().click();
  await p.waitForTimeout(1800);
  return { p, ctx };
}

const menuOpen = (p) => p.evaluate(() => Boolean(document.querySelector('[data-slot="dropdown-menu-content"]')));

// ── 1. 容器几何 + 上限 + 空态 ──
{
  const { p, ctx } = await open({ width: 1440, height: 900 });
  const g = await p.evaluate(() => {
    const s = document.querySelector('.ui-modal-surface');
    const cs = getComputedStyle(s);
    const f = document.querySelector('.alp-footer');
    return {
      radius: cs.borderRadius,
      display: cs.display,
      maxH: cs.maxHeight,
      overflow: cs.overflow,
      footerBottom: Math.round(f.getBoundingClientRect().bottom),
      innerH: innerHeight,
      contentScrolls: (() => {
        const c = document.querySelector('.alp-content');
        return c.scrollHeight > c.clientHeight;
      })(),
    };
  });
  ok(g.radius === '20px', `容器圆角 20px (实测 ${g.radius})`);
  ok(g.display === 'flex' && g.overflow === 'hidden' && g.maxH === '760px', `容器几何正确 (${g.display}/${g.overflow}/${g.maxH})`);
  ok(g.footerBottom <= g.innerH, `底部操作条在视口内 (bottom=${g.footerBottom} ≤ ${g.innerH})`);
  ok(g.contentScrolls, '内部素材区承担滚动');

  // 日期下拉 (radix): 点开 → 选项后自动关 → Esc 关
  ok(!(await menuOpen(p)), '日期菜单初始关闭');
  await p.click('.alp-date-trigger');
  await p.waitForTimeout(350);
  ok(await menuOpen(p), '点击触发键展开菜单');
  await p.click('[data-slot="dropdown-menu-item"]:has-text("昨天")');
  await p.waitForTimeout(400);
  ok(!(await menuOpen(p)), '点选后菜单自动关闭 (旧实现因 :hover 不关)');
  ok((await p.innerText('.alp-date-trigger')).includes('昨天'), '点选后触发键文案已更新');
  await p.click('.alp-date-trigger');
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok(!(await menuOpen(p)), 'Esc 关闭菜单');
  await p.click('.alp-date-trigger');
  await p.waitForTimeout(300);
  await p.mouse.click(700, 500);
  await p.waitForTimeout(400);
  ok(!(await menuOpen(p)), '点击外部关闭菜单');
  await p.click('.alp-date-trigger');
  await p.waitForTimeout(300);
  await p.click('[data-slot="dropdown-menu-item"]:has-text("全部")');
  await p.waitForTimeout(400);

  // 搜索: 输入 → 清除键出现且可用
  await p.fill('.alp-search input', 'zzz-no-such-asset-zzz');
  await p.waitForTimeout(500);
  const empty = await p.evaluate(() => document.querySelector('.alp-state')?.innerText ?? '');
  ok(empty.includes('没有符合条件的素材'), `筛选无结果文案正确 (${empty.split('\n')[0]})`);
  ok(!empty.includes('请先上传'), '筛选无结果不再谎报「请先上传」');
  ok(await p.locator('.alp-search-clear').isVisible(), '输入后出现清除键');
  await p.click('.alp-search-clear');
  await p.waitForTimeout(500);
  const cleared = await p.evaluate(() => ({
    v: document.querySelector('.alp-search input')?.value,
    cards: document.querySelectorAll('.alp-card').length,
  }));
  ok(cleared.v === '', `清除键清空输入 (实测 "${cleared.v}")`);
  ok(cleared.cards > 0, `清除后恢复列表 (${cleared.cards} 张)`);

  // 选择上限
  for (let i = 0; i < 6; i++) {
    const c = p.locator('.alp-card').nth(i);
    if (await c.isEnabled()) await c.click();
    await p.waitForTimeout(60);
  }
  const lim = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.alp-card')];
    const dis = cards.find((c) => c.disabled);
    return {
      selected: cards.filter((c) => c.classList.contains('is-selected')).length,
      disabled: cards.filter((c) => c.disabled).length,
      opacity: dis ? getComputedStyle(dis).opacity : null,
      selectedClickable: cards.filter((c) => c.classList.contains('is-selected')).every((c) => !c.disabled),
    };
  });
  ok(lim.selected === 5, `选满 5 张即停 (实测 ${lim.selected})`);
  ok(lim.disabled > 0 && lim.opacity === '0.45', `未选中卡片禁用且置灰 (${lim.disabled} 张 / opacity ${lim.opacity})`);
  ok(lim.selectedClickable, '已选中卡片仍可点 (能取消换选)');
  await ctx.close();
}

// ── 2. 三种视口下无横向溢出 ──
for (const vp of [
  { width: 1440, height: 900 },
  { width: 760, height: 700 },
  { width: 400, height: 720 },
]) {
  for (const which of ['alp', 'mum', 'login']) {
    const { p, ctx } = await open(vp, which === 'login' ? null : token);
    if (which !== 'alp') {
      // open() 已点了素材库入口; 未登录时弹的是登录框, 手机上传需重开
      if (which === 'mum') {
        await p.keyboard.press('Escape');
        await p.waitForTimeout(300);
        await p.getByText('手机上传', { exact: true }).first().click();
        await p.waitForTimeout(1500);
      }
    }
    const r = await p.evaluate(() => {
      const s = document.querySelector('.ui-modal-surface');
      return { radius: getComputedStyle(s).borderRadius, horiz: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    const want = which === 'login' ? '12px' : '20px';
    ok(!r.horiz, `${which}@${vp.width} 无横向溢出`);
    ok(r.radius === want, `${which}@${vp.width} 圆角 ${want} (实测 ${r.radius})`);
    await ctx.close();
  }
}

console.log(fail.length ? `\n${fail.length} 项失败` : '\n全部通过');
await b.close();
process.exit(fail.length ? 1 : 0);
