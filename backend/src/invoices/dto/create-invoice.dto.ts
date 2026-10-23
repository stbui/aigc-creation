import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * 开票申请。
 *
 * `kind` 决定 `taxNo` 是否必填 —— 企业抬头缺税号开出来的票无法报销,
 * 这里只做格式约束, 「企业必须有税号」的联动校验在 service 里
 * (class-validator 的联动需要自定义装饰器, 为一条规则不值当)。
 */
export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty({ message: '请选择订单' })
  orderId!: string;

  @IsIn(['personal', 'company'], { message: '开票类型只能是 personal 或 company' })
  kind!: 'personal' | 'company';

  @IsString()
  @IsNotEmpty({ message: '请填写发票抬头' })
  @MaxLength(80, { message: '发票抬头最多 80 个字符' })
  title!: string;

  /** 纳税人识别号: 15/18/20 位字母数字 (统一社会信用代码 18 位) */
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{15,20}$/, { message: '纳税人识别号格式不正确' })
  taxNo?: string;

  @IsOptional()
  @IsEmail({}, { message: '接收邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  content?: string;
}
