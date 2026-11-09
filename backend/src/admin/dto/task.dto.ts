import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from './page-query.dto';

/**
 * 任务监控列表查询 (admin-prd.md B-29 / admin-detailed-design.md §5.1)。
 *
 * ⚠️ 必须**值导入** (不能用 `import type`): `@Query()` 的 DTO 依赖
 * `design:paramtypes` 做实例化与白名单剥离, 用 `import type` 会让
 * Query 类退化成 Function, 查询参数完全绕过校验。
 *
 * status 用白名单而非自由字符串: SQLite 无 enum, 库里的 status 是
 * 裸 String, 不校验就等于开放注入 —— 传错值得到空列表, 传对才有用,
 * 与其让用户猜, 不如直接报「取值非法」。
 */
export class TaskListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['queued', 'running', 'succeeded', 'failed', 'cancelled'], { message: 'status 取值非法' })
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  capability?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  /** 失败任务按错误码定位；与「同因聚合」的快捷筛选共用 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  errorCode?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
