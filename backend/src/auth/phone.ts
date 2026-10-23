/**
 * 手机号归一化 —— 短信登录与注册绑定的唯一入口。
 *
 * 只接受中国大陆手机号（1 开头、第二位 3-9、共 11 位）：
 *   - 宽松到「任何数字串」会让 `SMS_*` 通道把请求发给不合法的号码，
 *     服务商报错信息通常与「号码不存在」混在一起，排障时无法区分；
 *   - 过窄（例如只认 +86 前缀）会把最常见的输入直接拒掉。
 *
 * 输入允许空格、短横线与 `+86` / `86` 前缀，输出恒为 11 位纯数字。
 * 归一化失败返回 null，由调用方决定报「手机号格式不正确」还是按不存在处理
 * （登录/找回类接口一律按不存在处理，避免账号枚举）。
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\s-]/g, '');
  if (s.startsWith('+86')) s = s.slice(3);
  else if (s.startsWith('0086')) s = s.slice(4);
  else if (s.startsWith('86') && s.length === 13) s = s.slice(2);
  return /^1[3-9]\d{9}$/.test(s) ? s : null;
}
