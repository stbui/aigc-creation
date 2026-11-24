/** 落库前截断渠道错误/报文，避免 `lastError` 与 Payment.message 无限增长。 */
export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
