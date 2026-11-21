/* 健康指标：成功率 → 语义色与展示文案。 */

export function healthTone(rate: number | null, samples: number): 'success' | 'warn' | 'danger' | 'muted' {
  if (rate === null || samples === 0) return 'muted';
  if (rate >= 0.95) return 'success';
  if (rate >= 0.8) return 'warn';
  return 'danger';
}

/**
 * 成功率展示。
 *
 * 只有**恰好 100%** 时才省略小数尾巴 —— 参考实现的口径是「≥ 99.5% 显示
 * 0 位小数」，那会让 99.5% 显示成 `100%`：一条十天挂一次的线在界面上
 * 读起来像是「从没失败过」。1 位小数在这个量级下足够精确，且不会说谎。
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(rate === 0 || rate === 1 ? 0 : 1)}%`;
}
