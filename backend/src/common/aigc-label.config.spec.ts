import { describe, expect, it } from 'vitest';
import { sanitizeAigcLabelSpec } from './aigc-label.config';

describe('sanitizeAigcLabelSpec', () => {
  it('字距按整数 px 收敛', () => {
    expect(sanitizeAigcLabelSpec({ letterSpacing: 2.5 }).letterSpacing).toBe(3);
    expect(sanitizeAigcLabelSpec({ letterSpacing: 2.4 }).letterSpacing).toBe(2);
  });
});
