import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** slug 统一口径：小写字母/数字/短横线，2–40 位。 */
const SLUG_RULE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export class CreateTemplateCategoryDto {
  @IsString()
  @Matches(SLUG_RULE, { message: 'slug 只能是小写字母/数字/短横线，长度 2~40' })
  slug!: string;

  @IsString()
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateTemplateCategoryDto {
  @IsOptional()
  @IsString()
  @Matches(SLUG_RULE, { message: 'slug 只能是小写字母/数字/短横线，长度 2~40' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateTemplateGroupDto {
  @IsString()
  categoryId!: string;

  @IsString()
  @Matches(SLUG_RULE, { message: 'slug 只能是小写字母/数字/短横线，长度 2~40' })
  slug!: string;

  @IsString()
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateTemplateGroupDto {
  @IsOptional()
  @IsString()
  @Matches(SLUG_RULE, { message: 'slug 只能是小写字母/数字/短横线，长度 2~40' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateTemplateItemDto {
  @IsString()
  groupId!: string;

  @IsString()
  @MaxLength(40)
  name!: string;

  @IsString()
  @MaxLength(4000)
  prompt!: string;

  /** 站内静态路径 / storage:// 引用 / http(s) 地址 */
  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateTemplateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
