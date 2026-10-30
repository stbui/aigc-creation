import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /assets/upload` 的 multipart 表单字段 (文件本身走 `file` 字段, 不在 DTO 内)。
 *
 * 来源三字段由浏览器扩展采集时提交, 人类用户从素材库直接上传时全部省略。
 * 这里只做**长度**校验; 协议与形态的宽松校验在 `AssetsService.normalizeSource`:
 * 采集来的元数据不该让整次上传失败 (图才是用户意图), 非法值按「未提供」处理。
 */
export class UploadAssetDto {
  @IsString()
  @MinLength(1)
  projectId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceSite?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  sourcePageUrl?: string;
}
