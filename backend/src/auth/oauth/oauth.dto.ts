import { IsOptional, IsString, MaxLength } from 'class-validator';

export class OAuthAuthorizeQueryDto {
  /** 登录完成后回跳的站内路径。服务端会再校验，只接受站内绝对路径 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnTo?: string;
}

export class OAuthCompleteDto {
  @IsString()
  ticket: string;
}
