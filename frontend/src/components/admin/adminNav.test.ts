import { describe, expect, it } from 'vitest';
import {
  ADMIN_MENU,
  findAdminMenuGroup,
  findAdminMenuItem,
  findAdminMenuItemsByPath,
} from './adminNav';

describe('后台导航分组', () => {
  it('按日常运营到资金、系统与安全的顺序排列', () => {
    expect(ADMIN_MENU.map((group) => group.name)).toEqual([
      '总览',
      '运营与内容',
      '模型与能力',
      '商品与交易',
      '资金与财务',
      '系统',
      '数据与安全',
    ]);
  });

  it('高频运营入口排在内容配置之前', () => {
    const items = findAdminMenuGroup('/admin/users')?.items.map((item) => item.label) ?? [];
    expect(items.slice(0, 3)).toEqual(['用户管理', '工单处理', '素材管理']);
    expect(items).toContain('站内消息');
    expect(items).toContain('AI 标识');
  });

  it('任务监控归入模型与能力，排在调用记录之后', () => {
    const items = findAdminMenuGroup('/admin/tasks')?.items.map((item) => item.label) ?? [];
    expect(findAdminMenuGroup('/admin/tasks')?.name).toBe('模型与能力');
    expect(items.slice(-2)).toEqual(['调用记录', '任务监控']);
  });
});

describe('后台支付菜单', () => {
  it('收款、核对、异常是三个独立入口', () => {
    expect(findAdminMenuItem('/admin/payments?tab=providers')?.label).toBe('收款设置');
    expect(findAdminMenuItem('/admin/payments?tab=reconciliation')?.label).toBe('交易核对');
    expect(findAdminMenuItem('/admin/payments?tab=exceptions')?.label).toBe('异常处理');
    expect(findAdminMenuGroup('/admin/payments?tab=reconciliation')?.name).toBe('资金与财务');
  });

  it('筛选参数不改变菜单归属', () => {
    const path = '/admin/payments?tab=reconciliation&status=failed&runId=run_1';
    expect(findAdminMenuItem(path)?.label).toBe('交易核对');
  });
});

describe('后台菜单的 pathname 兜底查找', () => {
  it('精确命中时只返回一项', () => {
    const items = findAdminMenuItemsByPath('/admin/payments?tab=exceptions');
    expect(items.map((item) => item.label)).toEqual(['异常处理']);
  });

  it('裸路径按 pathname 返回三个候选，权限一致', () => {
    const items = findAdminMenuItemsByPath('/admin/payments');
    expect(items.map((item) => item.label)).toEqual(['收款设置', '交易核对', '异常处理']);
    expect(items.every((item) => item.permission === 'payment.read')).toBe(true);
  });

  it('未知页签同样走 pathname 兜底', () => {
    const items = findAdminMenuItemsByPath('/admin/payments?tab=unknown');
    expect(items.map((item) => item.label)).toEqual(['收款设置', '交易核对', '异常处理']);
  });

  it('已知页签仍走精确匹配，不被兜底放大', () => {
    expect(findAdminMenuItemsByPath('/admin/payments?tab=reconciliation').length).toBe(1);
  });

  it('兜底不改变精确查找的既有行为', () => {
    expect(findAdminMenuItem('/admin/payments')).toBeUndefined();
    expect(findAdminMenuItem('/admin/payments?tab=exceptions')?.label).toBe('异常处理');
  });

  it('子路由由精确语义命中，不进入兜底', () => {
    expect(
      findAdminMenuItemsByPath('/admin/settings/generate').map((item) => item.label),
    ).toEqual(['系统设置']);
  });

  it('不属于菜单的路径返回空数组', () => {
    expect(findAdminMenuItemsByPath('/admin/credit-prices')).toEqual([]);
    expect(findAdminMenuItemsByPath('/admin/not-a-page')).toEqual([]);
  });

  it('末尾斜杠与额外筛选参数不影响精确命中', () => {
    expect(
      findAdminMenuItemsByPath('/admin/payments/?tab=reconciliation&status=failed').map(
        (item) => item.label,
      ),
    ).toEqual(['交易核对']);
  });
});
