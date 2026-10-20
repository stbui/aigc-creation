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
  @IsIn(['pending', 'running', 'succeeded', 'failed'], { message: 'status 取值非法' })
  status?: 'pending' | 'running' | 'succeeded' | 'failed';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  capability?: string;

  /**
   * 通道。落库值是 `gateway`(真实模型) / `local`(本地算法) / `mock`(未回落前),
   * 前端按 gateway|local 二值筛选 —— `mock` 是任务的初始值, 任务跑完后
   * processTask 会把它改写成实际通道, 因此它只在"刚建、还没跑完"时可见。
   */
  @IsOptional()
  @IsIn(['gateway', 'local', 'mock'], { message: 'provider 取值非法' })
  provider?: 'gateway' | 'local' | 'mock';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
