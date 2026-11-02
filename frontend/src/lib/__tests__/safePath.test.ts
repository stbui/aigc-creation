import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '../safePath';

/**
 * 登录回跳 / 通知 link / 推广位 cta 共用同一套校验。
 * 这里覆盖开放重定向的常见变体，避免以后有人把校验写回去成 startsWith('/')。
 */
describe('safeInternalPath', () => {
  it('接受站内绝对路径并保留查询串与 hash', () => {
    expect(safeInternalPath('/qr-login?ticket=abc')).toBe('/qr-login?ticket=abc');
    expect(safeInternalPath('/works#top')).toBe('/works#top');
  });

  it.each([
    ['协议相对地址', '//evil.com'],
    ['反斜杠变体', '/\\evil.com'],
    ['绝对外链', 'https://evil.com'],
    ['控制字符', '/works\nSet-Cookie: x'],
    ['空值', ''],
    ['登录页自身', '/login'],
  ])('拒绝%s', (_label, value) => {
    expect(safeInternalPath(value, '/workbench')).toBe('/workbench');
  });

  it('允许调用方用空 fallback 表示“忽略”', () => {
    expect(safeInternalPath('https://evil.com', '')).toBe('');
  });
});
