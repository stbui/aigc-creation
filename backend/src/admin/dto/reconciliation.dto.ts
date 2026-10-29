import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * 对账批次列表查询。
 *
 * 日期按 `billDate`（渠道营业日）过滤，而不是导入时间：财务核对「某一天的账」
 * 时关心的是营业日。limit/offset 沿用该接口原有的轻量分页参数。
 */
export class ReconciliationBatchListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(['sandbox', 'alipay', 'wechat'], { message: 'channel 取值非法' })
  channel?: string;

  @IsOptional()
  @IsIn(['imported', 'resolved'], { message: 'status 取值非法' })
  status?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from 必须是 YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to 必须是 YYYY-MM-DD' })
  to?: string;
}
