import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * 工单列表查询（后台）。
 *
 * `assigneeId=unassigned` 表示只看未指派 —— 这是客服主管每天的第一个动作：
 * 把没人认领的单分下去。用字面量而不是再加一个布尔参数，少一个可配错的东西。
 */
export class AdminTicketListQueryDto {
  @IsOptional()
  @IsIn(["open", "processing", "resolved", "closed"], {
    message: "status 取值非法",
  })
  status?: string;

  @IsOptional()
  @IsIn(["bug", "complaint", "consultation", "invoice", "other"], {
    message: "type 取值非法",
  })
  type?: string;

  @IsOptional()
  @IsIn(["low", "normal", "high"], { message: "priority 取值非法" })
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
  @IsIn(["open", "processing", "resolved", "closed"], {
    message: "status 取值非法",
  })
  status?: string;

  @IsOptional()
  @IsIn(["low", "normal", "high"], { message: "priority 取值非法" })
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  assigneeId?: string | null;
}

export class AdminTicketReplyDto {
  @IsString()
  @MinLength(1, { message: "回复内容不能为空" })
  @MaxLength(2000, { message: "回复最多 2000 个字" })
  content!: string;

  /**
   * `public` 会推送给用户；`internal` 只留在后台，用于转交与交接。
   * 默认 public，保持既有调用方行为不变。
   */
  @IsOptional()
  @IsIn(["public", "internal"], { message: "visibility 只能是 public 或 internal" })
  visibility?: "public" | "internal";
}

/**
 * 转交财务。
 *
 * 只改指派人、状态并写一条内部备注；不触碰订单、积分与退款 —— 资金动作
 * 仍在订单模块执行，工单只负责把人和上下文交出去。
 */
export class AdminTicketTransferDto {
  @IsString()
  @MinLength(1, { message: "请选择接收人" })
  @MaxLength(40)
  assigneeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: "交接备注最多 2000 个字" })
  note?: string;
}

/**
 * 批量指派 / 流转。
 *
 * 每条仍走 `adminUpdate` 的状态机与指派校验；批量只是省点击，不是绕过规则。
 */
export class AdminTicketBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: "单次批量最多 100 条" })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(["assign", "status"], { message: "action 只能是 assign 或 status" })
  action!: "assign" | "status";

  /** action=assign 时必填；null 表示取消指派 */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  assigneeId?: string | null;

  /** action=status 时必填 */
  @IsOptional()
  @IsIn(["open", "processing", "resolved", "closed"], {
    message: "status 取值非法",
  })
  status?: string;
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
