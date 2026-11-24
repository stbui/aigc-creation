/**
 * 目录端点共用 DTO。
 *
 * 从 models.controller 移入: 规范禁止从另一个 controller 文件导入 DTO,
 * ChannelModelQuoteBodyDto (model-catalog) 继承本类, 必须有中立的归属。
 */
import { Allow, IsOptional, IsString } from 'class-validator';

/** 模型意图入参：能力 + 可选的参考素材数量与模型参数 */
export class ModelIntentBodyDto {
  @IsOptional() @IsString() capability?: string;
  @IsOptional() @IsString() modelKey?: string;
  @IsOptional() @IsString() operation?: string;
  @IsOptional() @Allow() inputs?: unknown;
  @IsOptional() @Allow() options?: unknown;
}
