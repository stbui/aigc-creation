/**
 * 创作端渠道模型目录（`/api/v1/model-catalog*`）。
 *
 *   · `GET  /model-catalog`            系统渠道 + 渠道模型公开目录（`models` 恒为空）
 *   · `POST /model-catalog/available`  带意图的目录（只保留能承接该意图的模型）
 *   · `POST /model-catalog/quote`      渠道模型报价（不建任务、不扣费）
 *
 * 与 `/models*` 并存但语义不同：`/models*` 是前台模型（产品视角），本组是渠道模型
 * （供应视角），C 端模型选择器读本组。三个端点都可以匿名访问（目录公开浏览），
 * 登录后按会员分组过滤渠道并折算价格。
 *
 * 报价必须带 `channelId` + `modelKey`：这两个字段是目录里唯一稳定的模型定位方式，
 * 不接受「用 modelKey 全局搜索」—— 不同渠道的同名模型价格与协议都可能不同。
 */

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { OptionalJwtAuthGuard } from '../../common/optional-jwt-auth.guard';
import { buildModelRequestIntent } from '../intent/model-intent';
import type { ModelRequestIntent } from '../intent/spec-types';
import { UserGroupService } from '../user-groups/user-group.service';
import { ModelIntentBodyDto } from './models.controller';
import { PublicModelCatalogService } from './public-model-catalog.service';

/**
 * 渠道模型报价入参：渠道 + 模型标识 + 意图。
 *
 * ⚠ 意图既接受**平铺**字段（`capability` / `operation` / …，本仓原口径），
 * 也接受**嵌套** `intent` 对象（参考实现 open-ai-canvas 的
 * `{ channelId, modelKey, intent: {...} }`）。两种都归一到同一份意图，
 * 迁移过来的客户端不会被 400 挡下。
 */
export class ChannelModelQuoteBodyDto extends ModelIntentBodyDto {
  @IsString() channelId: string;
  @IsString() modelKey: string;
  /** 嵌套意图（参考实现口径）；与平铺字段合并，平铺优先 */
  intent?: ModelIntentBodyDto;
}

function toIntent(body: (ModelIntentBodyDto & { intent?: ModelIntentBodyDto }) | undefined): ModelRequestIntent {
  const nested = body?.intent;
  return buildModelRequestIntent({
    capability: body?.capability ?? nested?.capability,
    operation: body?.operation ?? nested?.operation,
    inputs: body?.inputs ?? nested?.inputs,
    options: body?.options ?? nested?.options,
  });
}

@Controller('model-catalog')
@UseGuards(OptionalJwtAuthGuard)
export class ModelCatalogController {
  constructor(
    private readonly catalog: PublicModelCatalogService,
    private readonly groups: UserGroupService,
  ) {}

  @Get()
  async list(@Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    return this.catalog.catalog(access);
  }

  @Post('available')
  async available(@Body() body: ModelIntentBodyDto, @Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    return this.catalog.catalog(access, toIntent(body));
  }

  @Post('quote')
  async quote(@Body() body: ChannelModelQuoteBodyDto, @Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    return {
      quote: await this.catalog.quote(access, body.channelId, body.modelKey, toIntent(body)),
    };
  }
}
