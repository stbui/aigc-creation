import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS_FOR_TEST } from './adminRouteAccessTestFixtures';
import {
  PUBLIC_ADMIN_ROUTES,
  ROUTE_ONLY_PERMISSIONS,
  resolveAdminRouteAccess,
} from '../adminRouteAccess';

/**
 * 后台路由级授权的判定表。
 *
 * 权限集口径与后端 `ROLE_PERMISSIONS` 对齐（内置三角色），这里用字面量复刻，
 * 避免测试 import backend（跨包）。角色矩阵变更时同步改 fixtures。
 *
 * 覆盖要求（诸葛亮派单）：
 *   ① finance 进 /admin/capabilities 被拒（T-043 后财务已无 product.price）
 *   ② /admin/payments 不带 tab 取并集放行
 *   ③ operator 直敲 storage / backups / scheduler / alerts 被拒
 *   ④ admin 全放行
 * 另加一条组件测试（adminRouteGuard.test.tsx）断言渲染 NoPageAccess 而非错误页。
 */

const { admin, operator, finance } = ROLE_PERMISSIONS_FOR_TEST;

const has = (granted: string[]) => (permission: string) => granted.includes(permission);

/** 判定结果压成一行，便于表驱动断言 */
function verdict(granted: string[], path: string): 'allow' | string {
  const decision = resolveAdminRouteAccess(path, has(granted));
  return decision.kind === 'allow' ? 'allow' : decision.required.join('|');
}

describe('后台路由授权：四条指定场景', () => {
  it('① finance 进 /admin/capabilities 被拒（T-043 后无 product.price）', () => {
    expect(verdict(finance, '/admin/capabilities')).toBe(
      'capability.read|logical_model.read',
    );
    // 带定价页签同样被拒：财务没有入口，也没有读取能力的权限
    expect(verdict(finance, '/admin/capabilities?tab=pricing')).toBe(
      'capability.read|logical_model.read',
    );
    // 旧深链重定向壳也必须拦住，否则等于绕过
    expect(verdict(finance, '/admin/credit-prices')).toBe(
      'capability.read|logical_model.read',
    );
  });

  it('② /admin/payments 无 tab 时取并集放行', () => {
    // 裸路径兜底出三条菜单项（收款设置 / 交易核对 / 异常处理），均 payment.read
    expect(verdict(finance, '/admin/payments')).toBe('allow');
    expect(verdict(finance, '/admin/payments?tab=unknown')).toBe('allow');
    expect(verdict(finance, '/admin/payments?tab=exceptions')).toBe('allow');
    // 无 payment.read 的角色仍被拒，且列出的所需权限是三条项的并集
    expect(verdict(operator, '/admin/payments')).toBe('payment.read');
  });

  it('③ operator 直敲无总闸页面：backups 被拒，storage/scheduler 按真实角色放行', () => {
    // backup.read 只有 admin 持有 → operator 直敲备份页被拒（该页原先会直接渲染接口错误）
    expect(verdict(operator, '/admin/backups')).toBe('backup.read');
    expect(verdict(operator, '/admin/retention')).toBe('backup.read');

    // ⚠ 与派单假设的差异：operator 在 ROLE_PERMISSIONS 里持有 setting.read
    // （backend/src/admin/permissions.ts:232），因此 storage / scheduler 放行。
    // 这是角色矩阵的既有事实，不是守卫漏判 —— 若要收紧需改后端角色，另开任务。
    expect(verdict(operator, '/admin/storage')).toBe('allow');
    expect(verdict(operator, '/admin/scheduler')).toBe('allow');

    // alerts 是 permission: null 的公共页（告警聚合，无敏感写操作），谁都放行
    expect(verdict(operator, '/admin/alerts')).toBe('allow');
    expect(verdict(finance, '/admin/alerts')).toBe('allow');
  });

  it('③b operator 直敲财务域页面被拒（PRD：订单/支付/积分/商品 operator 为 —）', () => {
    expect(verdict(operator, '/admin/products')).toBe('product.read');
    expect(verdict(operator, '/admin/orders')).toBe('order.read');
    expect(verdict(operator, '/admin/credits')).toBe('credit.read');
    expect(verdict(operator, '/admin/payments')).toBe('payment.read');
    expect(verdict(operator, '/admin/invoices')).toBe('invoice.write');
  });

  it('④ admin 全部放行', () => {
    for (const path of ALL_ADMIN_ROUTES) {
      expect(verdict(admin, path), path).toBe('allow');
    }
  });
});

describe('后台路由授权：边界', () => {
  it('末尾斜杠、query、hash 不影响判定', () => {
    expect(verdict(finance, '/admin/storage/')).toBe('setting.read');
    expect(verdict(finance, '/admin/storage?foo=1#bar')).toBe('setting.read');
    expect(verdict(finance, '/admin/storage//')).toBe('setting.read');
    expect(verdict(admin, '/admin/storage/')).toBe('allow');
    // 带 query 的页签页在末尾斜杠下仍按并集判定，不因斜杠退化成放行
    expect(verdict(operator, '/admin/payments/?tab=providers')).toBe('payment.read');
  });

  it('未知路径放行，交给 catch-all 显示 404', () => {
    expect(verdict(finance, '/admin/not-a-page')).toBe('allow');
    expect(verdict(operator, '/admin/uesrs')).toBe('allow');
  });

  it('重定向壳路由按目标页权限判定，不漏权限点', () => {
    expect(verdict(operator, '/admin/payment-channels')).toBe('payment.read');
    expect(verdict(operator, '/admin/reconciliation')).toBe('payment.read');
    expect(verdict(finance, '/admin/payment-channels')).toBe('allow');
  });

  it('权限并集：命中多项时任一命中即放行', () => {
    // 只持 logical_model.read（无 capability.read）也能进能力页
    expect(verdict(['logical_model.read'], '/admin/capabilities')).toBe('allow');
    expect(verdict(['capability.read'], '/admin/capabilities')).toBe('allow');
    expect(verdict(['product.price'], '/admin/capabilities')).toBe(
      'capability.read|logical_model.read',
    );
  });
});

/**
 * 全路由解析表：`layout.tsx` 里每个 `<Route>` 与守卫判定结果。
 *
 * `ROUTE_ONLY_PERMISSIONS` / 菜单都必须覆盖到这里列出的每个真实路径 ——
 * 新增路由而忘了给权限映射时，本表会红。
 */
const LAYOUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../layout.tsx');

/**
 * 从 `layout.tsx` 源码解析真实注册的后台路由。
 *
 * 手写清单只能证明「我列的那些有判定」，证明不了「新加的页面也有判定」——
 * 新增 `<Route>` 而忘了配 nav 时，守卫对未知路径是放行的（交给
 * `NotImplementedPage`），手写清单不会红。这里直接读源码，让漏配必然失败。
 *
 * 解析规则：
 *   - 只取 `<Routes>` 与 `</Routes>` 之间的内容；
 *   - 按 `<Route` 切段，每段取第一个 `path="..."`（本文件里 path 总在 element 之前）；
 *   - 没有 path 的是 index 路由，即概览 `/admin`；
 *   - `path="*"` 原样保留为 `*`，它是 catch-all，不属于具体页面。
 */
function parseAdminRoutesFromLayout(source: string): string[] {
  const start = source.indexOf('<Routes>');
  const end = source.indexOf('</Routes>');
  if (start === -1 || end === -1) {
    throw new Error('layout.tsx 里找不到 <Routes> 块，解析器需要同步更新');
  }
  const block = source.slice(start + '<Routes>'.length, end);
  return block
    .split('<Route')
    .slice(1)
    .map((segment) => {
      const matched = segment.match(/path="([^"]+)"/);
      if (!matched) return '/admin';
      const routePath = matched[1];
      return routePath === '*' ? '*' : `/admin/${routePath}`;
    });
}

const REGISTERED_ROUTES = parseAdminRoutesFromLayout(readFileSync(LAYOUT_PATH, 'utf8'));
/** 去掉 catch-all 后的真实页面路由 */
const REGISTERED_PAGES = REGISTERED_ROUTES.filter((path) => path !== '*');

/** 手写期望表：只用来对账「源码里到底有哪些路由」，不作为判定依据 */
const ALL_ADMIN_ROUTES: string[] = [
  '/admin',
  '/admin/alerts',
  '/admin/users',
  '/admin/roles',
  '/admin/email',
  '/admin/settings',
  '/admin/settings/generate',
  '/admin/settings/upload',
  '/admin/settings/backup',
  '/admin/settings/performance',
  '/admin/settings/security',
  '/admin/backups',
  '/admin/assets',
  '/admin/storage',
  '/admin/coupons',
  '/admin/campaigns',
  '/admin/marketing-rules',
  '/admin/scheduler',
  '/admin/channels',
  '/admin/user-groups',
  '/admin/plugins',
  '/admin/billing-orders',
  '/admin/finance',
  '/admin/model-calls',
  '/admin/capabilities',
  '/admin/tasks',
  '/admin/tickets',
  '/admin/credit-prices',
  '/admin/products',
  '/admin/membership-plans',
  '/admin/orders',
  '/admin/credits',
  '/admin/retention',
  '/admin/payments',
  '/admin/payment-rules',
  '/admin/invoices',
  '/admin/payment-channels',
  '/admin/reconciliation',
  '/admin/notifications',
  '/admin/templates',
  '/admin/prompts',
  '/admin/aigc-label',
];

describe('后台路由解析表（对账 layout.tsx 源码）', () => {
  it('源码解析出 42 条页面路由 + 1 条 catch-all', () => {
    expect(REGISTERED_PAGES).toHaveLength(42);
    expect(REGISTERED_ROUTES).toContain('*');
  });

  it('解析结果与手写期望表完全相等（多、少都红）', () => {
    expect([...REGISTERED_PAGES].sort()).toEqual([...ALL_ADMIN_ROUTES].sort());
  });

  it('每条真实路由都能解析到权限门槛，没有一条落进「未知路径放行」', () => {
    const unmapped: string[] = [];
    for (const path of REGISTERED_PAGES) {
      const decision = resolveAdminRouteAccess(path, () => false);
      if (decision.kind === 'allow') {
        // 允许放行的只有：菜单里 permission 为 null 的公共页（PUBLIC_ADMIN_ROUTES）
        if (!PUBLIC_ADMIN_ROUTES.includes(path)) unmapped.push(path);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('公共页与 catch-all 的放行是显式的，不靠遗漏', () => {
    for (const path of PUBLIC_ADMIN_ROUTES) {
      expect(REGISTERED_PAGES, `${path} 在豁免表里但路由已不存在`).toContain(path);
      expect(resolveAdminRouteAccess(path, () => false).kind).toBe('allow');
    }
    // catch-all 不参与页面判定：未知路径放行只为了交给 NotImplementedPage 显示 404
    expect(resolveAdminRouteAccess('/admin/not-a-page', () => false).kind).toBe('allow');
  });

  it('重定向壳表的每个键都是真实路由，且都有权限门槛', () => {
    const shells = Object.keys(ROUTE_ONLY_PERMISSIONS);
    expect(shells.sort()).toEqual(
      ['/admin/credit-prices', '/admin/payment-channels', '/admin/reconciliation'].sort(),
    );
    for (const shell of shells) {
      expect(REGISTERED_PAGES, `${shell} 在壳表里但路由已不存在`).toContain(shell);
      expect(resolveAdminRouteAccess(shell, () => false).kind).toBe('deny');
    }
  });

  it('每条路由对 admin 都有确定判定', () => {
    for (const path of ALL_ADMIN_ROUTES) {
      const decision = resolveAdminRouteAccess(path, has(admin));
      expect(['allow', 'deny']).toContain(decision.kind);
    }
  });
});
