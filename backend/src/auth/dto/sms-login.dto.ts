import { IsString, Length, Matches } from 'class-validator';

const PHONE_PATTERN = /^(\+?86[\s-]?)?1[3-9]\d{9}$/;

export class SmsLoginDto {
  @IsString()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @Length(6, 6, { message: '请输入 6 位验证码' })
  code: string;
}
