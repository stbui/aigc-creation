import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '../admin/dto/page-query.dto';

/** 提示词适用模态，与 `common/modality.ts` 的 Modality 同口径。 */
export const PROMPT_MODALITIES = ['image', 'video', 'text'] as const;
export type PromptModality = (typeof PROMPT_MODALITIES)[number];

/** 单条提示词的配图上限。与前端上传控件、素材库多选上限保持一致。 */
export const PROMPT_IMAGES_MAX = 9;

/**
 * 配图引用。
 *
 * `assetId` 只在从素材库选取时写入；`ref` 才是渲染依据 —— 它是稳定引用
 * （`storage://<backend>/<key>` / `/templates/...` / http 地址），不存签名地址，
 * 否则签名过期后历史配图会集体 403。
 */
export class PromptImageDto {
  @IsString()
  @MaxLength(500)
  ref!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 后台提示词列表查询。 */
export class PromptListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsIn(PROMPT_MODALITIES, { message: 'modality 取值非法' })
  modality?: PromptModality;

  /** query string 是字符串，这里统一转成布尔；非法值交给 @IsBoolean 拦下。 */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'enabled 只能是 true / false' })
  enabled?: boolean;
}

export class CreatePromptDto {
  /** 可留空：标题只是检索辅助，正文才是主体 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60, { message: '标题不能超过 60 个字符' })
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40, { message: '分类不能超过 40 个字符' })
  category?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(4000, { message: '提示词不能超过 4000 个字符' })
  content!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000, { message: '反向提示词不能超过 2000 个字符' })
  negativePrompt?: string;

  @IsOptional()
  @IsIn(PROMPT_MODALITIES, { message: 'modality 取值非法' })
  modality?: PromptModality;

  @IsOptional()
  @IsArray({ message: 'tags 必须是数组' })
  @ArrayMaxSize(8, { message: '标签最多 8 个' })
  @IsString({ each: true, message: '标签必须是字符串' })
  @MaxLength(20, { each: true, message: '单个标签不能超过 20 个字符' })
  tags?: string[];

  @IsOptional()
  @IsArray({ message: 'images 必须是数组' })
  @ArrayMaxSize(PROMPT_IMAGES_MAX, { message: `配图最多 ${PROMPT_IMAGES_MAX} 张` })
  @ValidateNested({ each: true })
  @Type(() => PromptImageDto)
  images?: PromptImageDto[];

  @IsOptional()
  @IsInt({ message: '排序必须是整数' })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

export class UpdatePromptDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60, { message: '标题不能超过 60 个字符' })
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40, { message: '分类不能超过 40 个字符' })
  category?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000, { message: '提示词不能超过 4000 个字符' })
  content?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000, { message: '反向提示词不能超过 2000 个字符' })
  negativePrompt?: string;

  @IsOptional()
  @IsIn(PROMPT_MODALITIES, { message: 'modality 取值非法' })
  modality?: PromptModality;

  @IsOptional()
  @IsArray({ message: 'tags 必须是数组' })
  @ArrayMaxSize(8, { message: '标签最多 8 个' })
  @IsString({ each: true, message: '标签必须是字符串' })
  @MaxLength(20, { each: true, message: '单个标签不能超过 20 个字符' })
  tags?: string[];

  @IsOptional()
  @IsArray({ message: 'images 必须是数组' })
  @ArrayMaxSize(PROMPT_IMAGES_MAX, { message: `配图最多 ${PROMPT_IMAGES_MAX} 张` })
  @ValidateNested({ each: true })
  @Type(() => PromptImageDto)
  images?: PromptImageDto[];

  @IsOptional()
  @IsInt({ message: '排序必须是整数' })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}
