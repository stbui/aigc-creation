/**
 * 素材库列表查询参数。
 *
 * DTO 层先挡住非法值 (负 offset / 超大 limit), service 内的 clamp 保留为
 * 兜底 —— 素材墙默认 60 张/页、上限 200 是存量口径, 未强制对齐 20/100。
 */
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class AssetListQueryDto {
  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  capability?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(200, { message: 'limit 最大为 200' })
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'offset 必须是整数' })
  @Min(0, { message: 'offset 不能为负' })
  offset?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  /** 日期筛选 (当天语义), 格式非法时 service 忽略该条件而不报错 */
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
