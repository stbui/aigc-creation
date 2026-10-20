import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PromptToolsService, type PromptToolResult } from './prompt-tools.service';
import { PolishPromptDto } from './dto/polish-prompt.dto';
import { ImageToPromptDto } from './dto/image-to-prompt.dto';
import { AppError } from '../common/app.exception';
import { GatewayUnavailableError } from '../providers/gateway.types';

/**
 * 提示词工具接口 —— AI 润色 / 图片转提示词。
 *
 * ## 鉴权
 *
 * 挂 JwtAuthGuard: 参考站这两个入口未登录时弹登录框, 不放匿名调用。
 * (「从素材库导入」同理。)
 *
 * ## 错误语义
 *
 * 通道不可用 → 502 + 可读文案, **不回落**。
 * 文本没有本地兜底可言, 编一段模板文案会让用户误以为是模型产出 ——
 * 这是本项目一贯的"不把本地伪装成模型结果"约定。
 */
@Controller('prompt-tools')
@UseGuards(JwtAuthGuard)
export class PromptToolsController {
  constructor(private readonly service: PromptToolsService) {}

  /** AI 润色 */
  @Post('polish')
  async polish(@CurrentUser() user: AuthUser, @Body() dto: PolishPromptDto): Promise<PromptToolResult> {
    try {
      return await this.service.polish(dto.text, dto.textOnly ?? false);
    } catch (e) {
      throw toClientError(e);
    }
  }

  /** 图片转提示词 */
  @Post('image-to-prompt')
  async imageToPrompt(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImageToPromptDto,
  ): Promise<PromptToolResult> {
    try {
      return await this.service.imageToPrompt(user.id, dto.assetId, dto.extra);
    } catch (e) {
      throw toClientError(e);
    }
  }
}

/**
 * 通道错误 → 客户端可读错误。
 *
 * ⚠️ 保留原始 message 而非统一"服务不可用": 运营要能一眼看出是
 * "基址没配" 还是 "令牌无效" 还是 "超时" —— 这些的处置动作完全不同。
 */
function toClientError(e: unknown): unknown {
  if (e instanceof GatewayUnavailableError) {
    return new AppError(50201, e.message, 502);
  }
  return e;
}
