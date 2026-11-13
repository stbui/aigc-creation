import { IsArray, IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';
import { SUBMITTABLE_CAPABILITY_IDS } from '../../capabilities/capability.registry';

/**
 * 白名单来自 capability.registry (SUBMITTABLE_CAPABILITY_IDS = mode 为 real 的能力),
 * planned 能力不在其中, 前端即使硬传也会被 400 拦下。
 */
export class CreateGenerationDto {
  @IsString()
  projectId: string;

  @IsIn(SUBMITTABLE_CAPABILITY_IDS)
  capability: string;

  /**
   * C 端模型分组键（`ChannelModel.modelGroupKey`，空则回落 modelKey）。
   *
   * 必填：客户端只能表达「用哪个模型分组 + 什么参数」，具体渠道与线路由
   * 服务端在同一能力的候选池里解析 —— 这是「展示的模型」与「实际执行并
   * 扣费的线路」同源的唯一保证。
   */
  @IsString()
  @Length(1, 120)
  modelKey: string;

  @IsArray()
  @IsString({ each: true })
  inputAssetIds: string[];

  @IsOptional()
  @IsObject()
  params?: Record<string, any>;

  /** 客户端请求幂等键；也可通过 Idempotency-Key 头传入。 */
  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey 格式无效' })
  idempotencyKey?: string;
}
