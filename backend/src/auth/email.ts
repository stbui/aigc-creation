/**
 * 邮箱登录标识统一归一化。
 *
 * 邮箱的 local-part 在 RFC 上区分大小写，但登录产品不能把同一邮箱的
 * 大小写变体视为两个账号：否则 A@x.com 注册后再用 a@x.com 登录会表现为
 * “账号不存在”，也容易被用于绕过按邮箱统计的限流。本项目统一 trim +
 * 小写，并在所有写入/查询路径复用本函数。
 */
export function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}
