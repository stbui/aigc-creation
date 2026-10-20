import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 分页与排序的公共查询参数。
 *
 * pageSize 上限 100: 无上限时运营可以一次拉全表, 把 SQLite 单写者拖垮,
 * 也让「导出」类操作绕过游标分页的保护。需要大批量时走导出端点。
 */
export class PageQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'page 必须是整数' })
  @Min(1, { message: 'page 最小为 1' })
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'pageSize 必须是整数' })
  @Min(1, { message: 'pageSize 最小为 1' })
  @Max(100, { message: 'pageSize 最大为 100' })
  pageSize?: number;

  /** 排序, 形如 `createdAt:desc`。field 必须是白名单内的列 */
  @IsOptional()
  @IsString()
  sort?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 解析后的分页参数 */
export interface NormalizedPage {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  orderBy: Record<string, 'asc' | 'desc'> | undefined;
}

/**
 * 归一化分页参数。
 *
 * sort 的 field 走白名单校验 —— 用户可控的字段名直接透传给 Prisma 的
 * orderBy 会被拒绝或产生意外行为, 白名单是必要的。
 */
export function buildPage(
  query: PageQueryDto,
  sortableFields: string[],
  defaultSort = 'createdAt:desc',
): NormalizedPage {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;

  const [rawField, rawDir] = (query.sort ?? defaultSort).split(':');
  const field = sortableFields.includes(rawField) ? rawField : sortableFields[0];
  const dir: 'asc' | 'desc' = rawDir === 'asc' ? 'asc' : 'desc';

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: field ? { [field]: dir } : undefined,
  };
}

/** 组装分页响应 */
export function paginate<T>(
  items: T[],
  total: number,
  page: NormalizedPage,
): PageResult<T> {
  return {
    items,
    total,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/** 账号状态白名单 (与 User.status 取值一致) */
export class UserStatusDto {
  @IsIn(['active', 'disabled', 'deleted'], { message: 'status 取值非法' })
  status!: 'active' | 'disabled' | 'deleted';
}