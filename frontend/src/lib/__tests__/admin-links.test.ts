import { describe, expect, it } from 'vitest';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderHref,
  adminOrderDetailHref,
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
    expect(adminAssetHref('asset 1')).toBe('/admin/assets?q=asset+1');
  });
});
