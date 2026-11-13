import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';

/**
 * 提示词预览请求。
 *
 * 只回放「最终会发给模型的那条提示词」，不建任务、不选路、不扣费。
 * 参数白名单由能力定义决定（`sanitizeParams`），客户端多传的字段一律丢弃。
 */
export class PromptPreviewDto {
  /** 能力参数；键必须是该能力声明过的参数名 */
  @IsOptional()
  @IsObject({ message: 'params 必须是对象' })
  params?: Record<string, unknown>;

  /**
   * 本次请求携带的参考素材张数。
   *
   * 与真实链路一致：提示词里的「共参考 N 张商品图」取自 `inputAssetIds.length`，
   * 预览必须用同一个来源，否则预览与实发提示词不一致 —— 那比没有预览更糟。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'refCount 必须是整数' })
  @Min(0, { message: 'refCount 不能小于 0' })
  @Max(10, { message: 'refCount 不能大于 10' })
  refCount?: number;
}
