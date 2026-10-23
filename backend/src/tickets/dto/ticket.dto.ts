import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { TICKET_PRIORITIES, TICKET_TYPES, type TicketPriority, type TicketType } from '../tickets.service';

/**
 * 新建工单。
 *
 * subject 上限 80 / content 上限 2000：与详情页与列表的展示宽度对齐，
 * 也避免用户把整篇文章贴进来（客服在手机上根本读不完）。
 */
export class CreateTicketDto {
  @IsIn(TICKET_TYPES as unknown as string[], { message: 'type 取值非法' })
  type!: TicketType;

  @IsString()
  @MinLength(2, { message: '标题至少 2 个字' })
  @MaxLength(80, { message: '标题最多 80 个字' })
  subject!: string;

  @IsString()
  @MinLength(5, { message: '问题描述至少 5 个字' })
  @MaxLength(2000, { message: '问题描述最多 2000 个字' })
  content!: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES as unknown as string[], { message: 'priority 取值非法' })
  priority?: TicketPriority;

  /** 关联订单（必须属于本人，service 校验） */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderId?: string;

  /** 关联素材（必须属于本人） */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  assetId?: string;
}

export class ReplyTicketDto {
  @IsString()
  @MinLength(1, { message: '回复内容不能为空' })
  @MaxLength(2000, { message: '回复最多 2000 个字' })
  content!: string;
}

export class MyTicketListQueryDto {
  @IsOptional()
  @IsIn(['open', 'processing', 'resolved', 'closed'], { message: 'status 取值非法' })
  status?: string;

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
