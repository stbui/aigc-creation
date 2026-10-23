import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  /**
   * 昵称。只允许这一个字段：邮箱是登录标识（改它等于换账号），
   * 手机号要走短信验证（绑号是安全动作）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  name?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '请输入当前密码' })
  oldPassword: string;

  @IsString()
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword: string;
}

export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  password: string;

  /** 确认词，必须是「注销」 */
  @IsString()
  @IsNotEmpty({ message: '请输入确认词「注销」' })
  confirm: string;
}
