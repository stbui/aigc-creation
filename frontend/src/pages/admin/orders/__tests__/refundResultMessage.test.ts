import { describe, expect, it } from 'vitest';

import { refundWarningMessage } from '../refundResultMessage';

describe('refundWarningMessage', () => {
  it('没有积分缺口和发票跟进时返回 null', () => {
    expect(
      refundWarningMessage({
        creditsReclaimed: 100,
        creditsUnreclaimable: 0,
        creditsExpired: 0,
        invoiceFollowUp: null,
        membershipTerminated: false,
      }),
    ).toBeNull();
  });

  it('合并展示无法回收的积分和发票跟进事项', () => {
    expect(
      refundWarningMessage({
        creditsReclaimed: 60,
        creditsUnreclaimable: 40,
        creditsExpired: 0,
        invoiceFollowUp: { message: '请到发票管理驳回该申请。' },
        membershipTerminated: false,
      }),
    ).toBe('回收积分 60，另有 40 积分已被消耗无法回收；请到发票管理驳回该申请。');
  });

  it('仅有发票跟进时直接返回发票提示', () => {
    expect(
      refundWarningMessage({
        creditsReclaimed: 0,
        creditsUnreclaimable: 0,
        creditsExpired: 0,
        invoiceFollowUp: { message: '请完成发票冲红登记。' },
        membershipTerminated: false,
      }),
    ).toBe('请完成发票冲红登记。');
  });

  it('只有实际终止会员时才提示终止', () => {
    expect(
      refundWarningMessage({
        creditsReclaimed: 25,
        creditsUnreclaimable: 0,
        creditsExpired: 0,
        invoiceFollowUp: null,
        membershipTerminated: true,
      }),
    ).toBe('会员权益已终止');

    expect(
      refundWarningMessage({
        creditsReclaimed: 25,
        creditsUnreclaimable: 0,
        creditsExpired: 0,
        invoiceFollowUp: null,
        membershipTerminated: false,
      }),
    ).toBeNull();
  });

  it('仅有过期份额时明确说明已过期作废', () => {
    expect(
      refundWarningMessage({
        creditsReclaimed: 0,
        creditsUnreclaimable: 0,
        creditsExpired: 30,
        invoiceFollowUp: null,
        membershipTerminated: false,
      }),
    ).toBe('回收积分 0，另有 30 积分已过期作废');
  });

  it('同时存在已消耗和已过期份额时分别说明', () => {
    expect(
      refundWarningMessage({
        creditsReclaimed: 50,
        creditsUnreclaimable: 20,
        creditsExpired: 10,
        invoiceFollowUp: { message: '请完成发票冲红登记。' },
        membershipTerminated: false,
      }),
    ).toBe('回收积分 50，另有 20 积分已被消耗无法回收，10 积分已过期作废；请完成发票冲红登记。');
  });
});
