import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from './page-query.dto';

/**
 * 模型调用记录查询。
 *
 * ⚠️ 必须**值导入** (不能用 `import type`): `@Query()` 的 DTO 依赖
 * `design:paramtypes` 做实例化与白名单剥离, 用 `import type` 会让
 * Query 类退化成 Function, 查询参数完全绕过校验。
 */
export class ModelCallListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  capability?: string;

  @IsOptional()
  @IsIn(['gateway', 'local'], { message: 'source 取值非法' })
  source?: 'gateway' | 'local';

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  success?: boolean;

  /** 是否发生回落 (网关失败后改走本地算法) */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  fallback?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/**
 * 模型配置写入。
 *
 * 字段是**任意键值对**而非固定字段 (与 AdminSettingsService 同构的取舍):
 * 配置项由 channel-config.defs.ts 声明, DTO 无法在编译期与之保持同步 ——
 * 硬编码字段会随配置项增减而漂移, 且新配置项还要改一遍 DTO。
 * 代价是无法做属性级校验, 故实际校验全部下沉到 service 的 validate()。
 *
 * 但仍显式声明 isObject, 至少拦住「提交了字符串/数组」这类结构性错误。
 */
export class UpdateModelConfigDto {
  /** 待写入的配置项 (key → value); 凭据类留空表示保持原值 */
  @IsOptional()
  @IsObject({ message: 'settings 必须是对象' })
  @Transform(({ value }) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}))
  settings!: Record<string, unknown>;

  /** 待清除的配置项 key (恢复为代码默认值) */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []))
  clears!: string[];

  /** 操作原因。修改生产关键路径配置属高危动作, 建议填写便于追溯 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * 通道连通性测试请求 (2026-10-20 三模态)。
 *
 * 模态缺省为 image —— 改造前该端点只有图像通道, 不传模态的存量脚本
 * (含监控/巡检) 不应因此改变行为。
 */
export class TestChannelDto {
  @IsOptional()
  @IsIn(['text', 'image', 'video'], { message: 'modality 取值非法' })
  modality?: 'text' | 'image' | 'video';

  /**
   * 草稿覆盖值 (2026-10-20)。
   *
   * 不传 = 按已保存配置测试（旧行为完全不变）；传了 = 用当前表单值测试，
   * 运营不必先保存就能验证「这份配置能不能通」。
   */
  @IsOptional()
  @IsObject({ message: 'overrides 必须是对象' })
  @Transform(({ value }) => (value && typeof value === 'object' && !Array.isArray(value) ? value : undefined))
  overrides?: {
    protocol?: string;
    baseUrl?: string;
    token?: string;
    model?: string;
    enabled?: boolean;
  };
}

function toBool({ value }: { value: unknown }): unknown {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}