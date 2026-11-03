/**
 * AdminInvoicesPage 的本地工具函数。
 */

export function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
