import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 扫码登录的票据。
 *
 * 长度下限设 32 是为了挡住「随手传一个短串」的探测: 真实票据是 64 位十六进制
 * (32 字节随机)。不做格式强校验 (仅 hex) —— 票据是服务端签发的, 格式错与
 * 「不存在」对调用方是同一种结果, 区分二者只会多给探测者一位信息。
 */
export class QrTicketDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  ticket!: string;
}

/** 手机端确认。`approve=false` 表示明确拒绝, 桌面端应立即停止轮询 */
export class QrConfirmDto extends QrTicketDto {
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

/** 轮询入参。**走 query 而非 body**, 便于前端用 GET 轮询 */
export class QrStatusQueryDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  ticket!: string;
}
