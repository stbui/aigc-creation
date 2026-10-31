import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PromptToolsService, type PromptToolResult } from './prompt-tools.service';
import { PolishPromptDto } from './dto/polish-prompt.dto';
import { ImageToPromptDto } from './dto/image-to-prompt.dto';

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
 * 没有可用文本线路 / 上游全部失败 → `50201` + 可读文案, **不回落**。
 * 该错误由 `TextToolService` 抛出, 带的是「上游为什么失败」的原因
 * (基址没配 / 令牌无效 / 超时), 运营据此可以直接判断处置动作。
 */
@Controller('prompt-tools')
@UseGuards(JwtAuthGuard)
export class PromptToolsController {
  constructor(private readonly service: PromptToolsService) {}

  /** AI 润色 */
  @Post('polish')
  async polish(@CurrentUser() user: AuthUser, @Body() dto: PolishPromptDto): Promise<PromptToolResult> {
    return this.service.polish(dto.text, dto.textOnly ?? false, user.id);
  }

  /** 图片转提示词 */
  @Post('image-to-prompt')
  async imageToPrompt(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImageToPromptDto,
  ): Promise<PromptToolResult> {
    return this.service.imageToPrompt(user.id, dto.assetId, dto.extra);
  }
}
