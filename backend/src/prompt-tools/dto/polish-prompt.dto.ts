import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * AI 润色请求。
 *
 * ⚠️ `text` 的长度上限 4000 与前端提示词框的 maxlength=4000 一致 ——
 * 两处独立写死会漂移, 故这里写死上限、前端也写死上限, 由前端先拦一道;
 * 后端这层是**兜底** (前端可被绕过, 直接打接口)。
 */
export class PolishPromptDto {
  /** 待润色的原始提示词 */
  @IsString()
  @MinLength(1, { message: '提示词不能为空' })
  @MaxLength(4000, { message: '提示词不超过 4000 字' })
  text: string;

  /**
   * 是否「仅润色文字」—— 参考站的开关。
   *
   * true  = 只改写措辞, 不增删画面要素 (保持主体/场景不变)
   * false = 允许补全画面要素 (默认, 更适合"我想不到那么多描述"的场景)
   */
  @IsOptional()
  @IsBoolean()
  textOnly?: boolean;
}
