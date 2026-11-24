/**
 * 后台账单 / 调用记录列表查询 DTO。
 *
 * page/pageSize 用 Transform 数字化, 替代原 controller 里的手工
 * numberOrUndefined(); 其余筛选为字符串, 语义校验 (状态枚举、日期格式)
 * 仍由 service 的 where/paging 归一化兜底。
 */
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../admin/dto/page-query.dto';

/** 生成账单列表查询 (GET /admin/billing-orders) */
export class BillingOrderListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() channelId?: string;
  @IsOptional() @IsString() billingMode?: string;
  @IsOptional() @IsString() group?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/** 上游调用记录查询 (GET /admin/api-logs 及 export 共用) */
export class ApiLogListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() requestKind?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() operation?: string;
  @IsOptional() @IsString() channelId?: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() model?: string;
  /** 'true'/'false' 之外的值由 service 的 where 归一化忽略 */
  @IsOptional() @IsString() billable?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/** 人工核对入参：动作只允许 settle / refund（语义校验在 service） */
export class BillingResolveBodyDto {
  @IsIn(['settle', 'refund'], { message: '核对动作只支持 settle / refund' })
  action!: string;
  @IsString()
  @IsNotEmpty({ message: '请填写核对依据' })
  @MaxLength(500)
  reason!: string;
}

/** 批量核对入参：ids 为逗号分隔的账单 id 串 (与前端批量提交口径一致) */
export class BillingBatchResolveBodyDto {
  @IsString() ids?: string;
  @IsIn(['settle', 'refund'], { message: '核对动作只支持 settle / refund' })
  action!: string;
  @IsString()
  @IsNotEmpty({ message: '请填写核对依据' })
  @MaxLength(500)
  reason!: string;
}
