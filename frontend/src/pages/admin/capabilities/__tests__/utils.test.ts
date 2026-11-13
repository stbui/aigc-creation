import { describe, expect, it } from 'vitest';
import { bindingCanRun, bindingIssue } from '../utils';

const executable = {
  enabled: true,
  channelEnabled: true,
  modelEnabled: true,
  priceConfigured: true,
};

describe('能力绑定可执行口径', () => {
  it('按供应商、商品、定价、参与选路顺序给出阻断原因', () => {
    expect(bindingIssue({ ...executable, channelEnabled: false })).toBe('供应商已停用');
    expect(bindingIssue({ ...executable, modelEnabled: false })).toBe('商品已停用');
    expect(bindingIssue({ ...executable, priceConfigured: false })).toBe('商品未定价');
    expect(bindingIssue({ ...executable, enabled: false })).toBe('未参与选路');
  });

  it('四个开关全部就绪才算可执行', () => {
    expect(bindingCanRun(executable)).toBe(true);
    expect(bindingCanRun({ ...executable, priceConfigured: false })).toBe(false);
  });
});
