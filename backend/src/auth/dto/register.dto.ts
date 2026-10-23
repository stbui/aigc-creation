import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * 中国大陆手机号（含可选 +86 前缀，允许空格与短横线）。
 * 归一化在 `phone.ts` 里完成，这里只拦明显不合法的输入。
 */
const PHONE_PATTERN = /^(\+?86[\s-]?)?1[3-9]\d{9}$/;

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  /**
   * 昵称 —— **必填**。
   *
   * 前端注册表单此前把该字段设为 hidden 却仍在提交 undefined, 导致注册必然
   * 卡在校验 ("name must be a string")。修法是把字段还给用户, 而不是把
   * 后端改成选填: 昵称会出现在作品、邀请、订单等所有用户可见的位置,
   * 缺省用邮箱前缀拼出来的名字既难看又可能撞车。
   *
   * 用 @IsNotEmpty 而不是 @IsString + @MinLength(1)：三者同时失败时,
   * main.ts 的 flattenValidationErrors 取 constraints 的第一条, 实际取到的是
   * 「昵称最多 20 个字符」——同一条错误里最不相关的那个。只留 IsNotEmpty 后
   * 缺昵称的提示就是「请输入昵称」。纯空白字符串由 AuthService 的 trim 拦截。
   */
  @IsNotEmpty({ message: '请输入昵称' })
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  name: string;

  /**
   * 可选手机号。
   *
   * 填了就必须同时给 `smsCode` —— 否则任何人可以把别人的号码绑到自己账号上，
   * 之后该号码的持有者用短信登录会进到一个陌生的空账号里。
   */
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone?: string;

  /** 短信验证码（`POST /auth/sms/send`，purpose=verify） */
  @IsOptional()
  @IsString()
  @MaxLength(6)
  smsCode?: string;

  /**
   * 同意的用户协议版本（`GET /legal` 返回的 version）。
   *
   * 选填而不是必填：后端不该因为前端漏传一个版本号就拒绝注册 ——
   * 但那意味着这次注册**没有同意凭证**，所以只在实际给了版本号时才落库，
   * 绝不替用户补一个"默认同意"。
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  consentVersion?: string;
}
