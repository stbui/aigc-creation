import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from './page-query.dto';

/**
 * 素材/项目列表查询。
 *
 * ⚠ 必须用真正的 DTO 而不是 `Record<string, unknown>`:
 *   全局 ValidationPipe 配了 transform:true, 负责把 query string 转成 number。
 *   若走 Record<string, unknown>, pageSize 会保持字符串 "20" 直接透传给
 *   Prisma, 报 `take: Invalid value. Expected Int, provided String` —— 500。
 */
export class AssetListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  keyword?: string;

  @IsOptional()
  @IsIn(['original', 'generated'])
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  capability?: string;

  @IsOptional()
  @IsIn(['visible', 'hidden'])
  status?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(['local', 'oss', 'minio'])
  backend?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : new Date(value)))
  from?: Date;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : new Date(value)))
  to?: Date;
}

export class ProjectListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  keyword?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}
