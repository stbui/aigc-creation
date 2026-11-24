import { describe, expect, it } from 'vitest';
import { assertSafeKey, maskSecret } from './storage.utils';

describe('key 与脱敏工具', () => {
  it('拒绝目录穿越 / 绝对路径 / 反斜杠 / 非法字符', () => {
    for (const key of ['../etc/passwd', '/etc/passwd', 'a\\b', '', 'a b.png']) {
      expect(() => assertSafeKey(key)).toThrow();
    }
    expect(() => assertSafeKey('original/202611/a-b_c.png')).not.toThrow();
  });

  it('maskSecret 只保留末 4 位且短值全遮蔽', () => {
    expect(maskSecret('abcdefgh')).toBe('****efgh');
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret(undefined)).toBeUndefined();
  });
});