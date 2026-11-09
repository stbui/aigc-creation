import { describe, expect, it } from 'vitest';
import {
  buildAdminContextLink,
  readAdminActionContext,
  readAdminDone,
  safeAdminReturnTo,
  withAdminDone,
} from './admin-context-link';

describe('admin-context-link', () => {
  it('只接受站内 /admin 路径作为 returnTo', () => {
    expect(safeAdminReturnTo('/admin/users?id=1')).toBe('/admin/users?id=1');
    expect(safeAdminReturnTo('/admin')).toBe('/admin');
    expect(safeAdminReturnTo('https://evil.example/admin')).toBeNull();
    expect(safeAdminReturnTo('//evil.example/admin')).toBeNull();
    expect(safeAdminReturnTo('/adminfoo')).toBeNull();
    expect(safeAdminReturnTo('/workbench')).toBeNull();
    expect(safeAdminReturnTo(null)).toBeNull();
  });

  it('构造目标链接并保留来源与返回地址', () => {
    const link = buildAdminContextLink({
      path: '/admin/orders',
      id: 'o-1',
      intent: 'refund',
      from: 'ticket:t-1',
      returnTo: '/admin/tickets?id=t-1',
    });
    const params = new URL(link, 'http://local').searchParams;
    expect(link.startsWith('/admin/orders?')).toBe(true);
    expect(params.get('id')).toBe('o-1');
    expect(params.get('intent')).toBe('refund');
    expect(params.get('from')).toBe('ticket:t-1');
    expect(params.get('returnTo')).toBe('/admin/tickets?id=t-1');
  });

  it('忽略非法 intent 与外部 returnTo', () => {
    const params = new URLSearchParams('intent=evil&returnTo=https%3A%2F%2Fevil.example');
    expect(readAdminActionContext(params)).toEqual({
      intent: null,
      from: null,
      returnTo: null,
    });
  });

  it('在来源地址上追加完成标记', () => {
    expect(withAdminDone('/admin/tickets?id=t-1', 'refunded')).toBe(
      '/admin/tickets?id=t-1&done=refunded',
    );
    expect(readAdminDone(new URLSearchParams('done=refunded'))).toBe('refunded');
    expect(readAdminDone(new URLSearchParams('done='))).toBeNull();
  });
});
