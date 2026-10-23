import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 工单列表查询（后台）。
 *
 * `assigneeId=unassigned` 表示只看未指派 —— 这是客服主管每天的第一个动作：
 * 把没人认领的单分下去。用字面量而不是再加一个布尔参数，少一个可配错的东西。
 */
export class AdminTicketListQueryDto {
  @IsOptional()
  @IsIn(['open', 'processing', 'resolved', 'closed'], { message: 'status 取值非法' })
  status?: string;

  @IsOptional()
  @IsIn(['bug', 'complaint', 'consultation', 'invoice', 'other'], { message: 'type 取值非法' })
  type?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'], { message: 'priority 取值非法' })
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  assigneeId?: string;

  /** 工单号 / 标题 / 正文 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * 工单处理。
 *
 * `assigneeId` 显式传 null = 取消指派；不传 = 不改。
 * 这两种语义必须可区分，否则「取消指派」无法表达。
 */
export class AdminTicketUpdateDto {
  @IsOptional()
  @IsIn(['open', 'processing', 'resolved', 'closed'], { message: 'status 取值非法' })
  status?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'], { message: 'priority 取值非法' })
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  assigneeId?: string | null;

  /** 操作原因。关闭/改优先级时写审计 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class AdminTicketReplyDto {
  @IsString()
  @MinLength(1, { message: '回复内容不能为空' })
  @MaxLength(2000, { message: '回复最多 2000 个字' })
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** 导出可带上与列表相同的筛选条件 */
export class AdminTicketExportQueryDto extends AdminTicketListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
