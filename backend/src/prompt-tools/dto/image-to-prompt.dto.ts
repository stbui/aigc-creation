import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 图片转提示词请求。
 *
 * 传的是**站内素材 id**而非图片 URL 或 base64:
 *   - 传 id → 后端自己从存储层取字节, 不会因为"用户传了个外链"而把本站
 *     变成任意 URL 代理 (SSRF 面)。
 *   - 传 id → 天然带归属校验 (素材属于当前用户才可读)。
 *   - 传 id → 前端不必把大图 base64 塞进请求体。
 */
export class ImageToPromptDto {
  /** 站内素材 id (assets 表主键) */
  @IsString()
  @MaxLength(64, { message: '素材 id 不合法' })
  assetId: string;

  /** 可选: 用户补充的额外要求, 如「重点描述材质」 */
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '补充要求不超过 200 字' })
  extra?: string;
}
