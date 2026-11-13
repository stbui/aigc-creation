import { describe, expect, it } from 'vitest';
import { ADMIN_MENU, findAdminMenuGroup, findAdminMenuItem } from './adminNav';

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
    expect(items.slice(0, 4)).toEqual(['用户管理', '任务监控', '工单处理', '素材管理']);
    expect(items).toContain('站内消息');
    expect(items).toContain('AI 标识');
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
