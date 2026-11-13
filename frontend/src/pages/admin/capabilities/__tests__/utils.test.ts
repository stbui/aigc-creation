import { describe, expect, it } from 'vitest';
import { bindingCanRun, bindingCostHint, bindingIssue, capabilityPriceText } from '../utils';

const executable = {
  enabled: true,
  channelEnabled: true,
  modelEnabled: true,
  priceConfigured: true,
};

describe('能力绑定可执行口径', () => {
  it('按供应商、商品、参与选路顺序给出阻断原因', () => {
    expect(bindingIssue({ ...executable, channelEnabled: false })).toBe('供应商已停用');
    expect(bindingIssue({ ...executable, modelEnabled: false })).toBe('商品已停用');
    expect(bindingIssue({ ...executable, enabled: false })).toBe('未参与选路');
  });

  it('三个运行开关全部就绪即可执行', () => {
    expect(bindingCanRun(executable)).toBe(true);
    expect(bindingCanRun({ ...executable, enabled: false })).toBe(false);
  });

  it('成本档缺失只提示毛利不可算，不阻断执行', () => {
    const unconfiguredCost = { ...executable, priceConfigured: false };
    expect(bindingCanRun(unconfiguredCost)).toBe(true);
    expect(bindingCostHint(unconfiguredCost)).toBe('成本未配置，毛利不可算');
    expect(bindingCostHint(executable)).toBeNull();
  });
});

describe('能力售价摘要', () => {
  it('按次与按时长使用业务单位，不展示内部计费枚举', () => {
    expect(
      capabilityPriceText({ billingMode: 'fixed_request', unitPriceMicrocredits: 2_000_000 }),
    ).toBe('2 积分 / 次');
    expect(
      capabilityPriceText({ billingMode: 'per_second', unitPriceMicrocredits: 500_000 }),
    ).toBe('0.5 积分 / 秒');
  });

  it('按 Token 计价时不用单值价格冒充售价', () => {
    expect(
      capabilityPriceText({ billingMode: 'token', unitPriceMicrocredits: 0 }),
    ).toBe('按 Token 计费');
  });
});
