import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  /** 邮件里的一次性令牌（base64url，32 字节随机串） */
  @IsString()
  @MinLength(16, { message: '重置链接无效' })
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  @MaxLength(64, { message: '密码最多 64 位' })
  password: string;
}
