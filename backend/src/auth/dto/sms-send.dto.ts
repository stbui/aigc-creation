import { IsIn, IsString, Matches } from 'class-validator';

/** 手机号（含可选 +86 前缀，允许空格与短横线），与 RegisterDto 同一规则 */
const PHONE_PATTERN = /^(\+?86[\s-]?)?1[3-9]\d{9}$/;

export class SmsSendDto {
  @IsString()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone: string;

  /**
   * 用途：
   *   - `login`  短信登录（该号码必须已注册）
   *   - `verify` 注册时验证手机号归属（号码尚未注册）
   *
   * 两个用途的令牌类型不同，不能混用 —— 否则注册时拿到的验证码可以直接
   * 用来登录任意已绑定该号码的账号。
   */
  @IsString()
  @IsIn(['login', 'verify'], { message: '不支持的验证码用途' })
  purpose: 'login' | 'verify';
}
