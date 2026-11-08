import { describe, expect, it } from 'vitest';

import { STATUS_META } from '../statusMeta';

describe('角色标签', () => {
  it('四种角色保留文字标识并使用互不相同的色调', () => {
    const roles = ['user', 'admin', 'operator', 'finance'] as const;
    const tones = roles.map((role) => STATUS_META[role].tone);

    expect(roles.map((role) => STATUS_META[role].label)).toEqual(['用户', '管理员', '运营', '财务']);
    expect(new Set(tones).size).toBe(roles.length);
  });
});
