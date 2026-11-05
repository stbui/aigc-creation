interface RefundResultNotice {
  creditsReclaimed: number;
  creditsUnreclaimable: number;
  invoiceFollowUp: { message: string } | null;
}

/** 退款成功但仍有需运营继续处理的事项；返回 null 表示可按普通成功提示。 */
export function refundWarningMessage(result: RefundResultNotice): string | null {
  const warnings = [
    result.creditsUnreclaimable > 0
      ? `回收积分 ${result.creditsReclaimed}，另有 ${result.creditsUnreclaimable} 积分已被消耗无法回收`
      : '',
    result.invoiceFollowUp?.message ?? '',
  ].filter(Boolean);
  return warnings.length > 0 ? warnings.join('；') : null;
}
