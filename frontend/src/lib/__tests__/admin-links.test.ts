import { describe, expect, it } from 'vitest';
import {
  adminAssetHref,
  adminCreditHref,
  adminModelCallsHref,
  adminOrderHref,
  adminOrderDetailHref,
  adminProductOrdersHref,
  adminTaskHref,
  adminTasksHref,
  adminUserDetailHref,
  adminUserHref,
} from '../admin-links';

describe('admin-links', () => {
  it('encodes values used by list filters', () => {
    expect(adminUserHref('user+tag@example.com')).toBe(
      '/admin/users?q=user%2Btag%40example.com',
    );
    expect(adminOrderHref({ orderNo: 'A/B 1' })).toBe('/admin/orders?orderNo=A%2FB+1');
    expect(adminCreditHref({ userId: 'user 1', email: 'a@b.com' })).toBe(
      '/admin/credits?userId=user+1&email=a%40b.com',
    );
    expect(adminUserDetailHref('user/1')).toBe('/admin/users?id=user%2F1');
    expect(adminOrderDetailHref('order 1')).toBe('/admin/orders?id=order+1');
  });

  it('omits empty filters and supports task and asset deep links', () => {
    expect(adminTasksHref({})).toBe('/admin/tasks');
    expect(adminTaskHref('task/1')).toBe('/admin/tasks?id=task%2F1');
    expect(adminModelCallsHref({ taskId: 'task/1' })).toBe(
      '/admin/model-calls?taskId=task%2F1',
    );
    expect(adminModelCallsHref({})).toBe('/admin/model-calls');
    expect(adminAssetHref('asset 1')).toBe('/admin/assets?q=asset+1');
  });

  it('商品订单深链同时带 id 与可读名称', () => {
    expect(adminProductOrdersHref('p-1', '双11 抢购包')).toBe(
      '/admin/orders?productId=p-1&productName=%E5%8F%8C11+%E6%8A%A2%E8%B4%AD%E5%8C%85',
    );
    // 没有名称时只带 id：筛选照样生效，标签回退显示 id
    expect(adminProductOrdersHref('p-1')).toBe('/admin/orders?productId=p-1');
  });
});
