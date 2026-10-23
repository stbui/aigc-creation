import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 模型线路（多渠道）相关 DTO。
 *
 * 校验分两层：
 *   - 结构/长度在这里（class-validator）；
 *   - 协议白名单、URL、启用时基址必填等业务规则在 service，
 *     因为「某模态能用哪些协议」来自协议层目录，不在 DTO 里复制一份。
 */

const MODALITIES = ['text', 'image', 'video'] as const;
type ModalityValue = (typeof MODALITIES)[number];

export class CreateModelChannelDto {
  @IsIn(MODALITIES, { message: 'modality 取值非法' })
  modality!: ModalityValue;

  @IsString()
  @IsNotEmpty({ message: '线路名称不能为空' })
  @MaxLength(60)
  name!: string;

  @IsString()
  @IsNotEmpty({ message: '对接协议不能为空' })
  @MaxLength(40)
  protocol!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class UpdateModelChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  protocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  /** 非空 = 更新；未传/空串 = 保持原值；清除请用 clearToken */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;

  @IsOptional()
  @IsBoolean()
  clearToken?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** 乐观并发：与线路当前 updatedAt 不一致时返回 409 */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class MoveModelChannelDto {
  @IsIn(['up', 'down'], { message: 'dir 只能是 up 或 down' })
  dir!: 'up' | 'down';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class MaterializeModelChannelDto {
  @IsIn(MODALITIES, { message: 'modality 取值非法' })
  modality!: ModalityValue;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class DeleteModelChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * 草稿测试（未保存也能测）。
 *
 * token 语义：
 *   未传      → 用已保存线路的令牌（带 id 时）
 *   ''        → 不带令牌测试
 *   非空      → 用草稿令牌
 */
export class TestModelChannelDraftDto {
  @IsIn(MODALITIES, { message: 'modality 取值非法' })
  modality!: ModalityValue;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  protocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 拉取厂商模型清单。
 *
 * 与草稿测试同样的 token 语义: 未传 = 用已保存线路的令牌（带 id 时必须）;
 * '' = 不带令牌; 非空 = 用草稿令牌。令牌只在本次请求内使用, 不落库、不进审计。
 */
export class ListModelChannelModelsDto {
  @IsIn(MODALITIES, { message: 'modality 取值非法' })
  modality!: ModalityValue;

  /** 已保存线路 id —— 用于复用其令牌与配置, 免去运营重填 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  protocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;
}

export class TestAllModelChannelsDto {
  @IsOptional()
  @IsIn(MODALITIES, { message: 'modality 取值非法' })
  modality?: ModalityValue;
}
