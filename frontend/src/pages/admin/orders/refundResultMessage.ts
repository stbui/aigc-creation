interface RefundResultNotice {
  creditsReclaimed: number;
  creditsUnreclaimable: number;
  creditsExpired: number;
  invoiceFollowUp: { message: string } | null;
  membershipTerminated: boolean;
}

/** 退款成功但仍有需运营继续处理的事项；返回 null 表示可按普通成功提示。 */
export function refundWarningMessage(result: RefundResultNotice): string | null {
  const shortages = [
    result.creditsUnreclaimable > 0 ? `${result.creditsUnreclaimable} 积分已被消耗无法回收` : '',
    result.creditsExpired > 0 ? `${result.creditsExpired} 积分已过期作废` : '',
  ].filter(Boolean);
  const warnings = [
    result.membershipTerminated ? '会员权益已终止' : '',
    shortages.length > 0
      ? `回收积分 ${result.creditsReclaimed}，另有 ${shortages.join('，')}`
      : '',
    result.invoiceFollowUp?.message ?? '',
  ].filter(Boolean);
  return warnings.length > 0 ? warnings.join('；') : null;
}
