import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
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

  @IsArray()
  @IsString({ each: true })
  inputAssetIds: string[];

  @IsOptional()
  @IsObject()
  params?: Record<string, any>;
}
