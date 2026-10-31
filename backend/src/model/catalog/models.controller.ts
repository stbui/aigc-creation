/**
 * 前台模型接口（`/api/v1/models`）。
 *
 * 移植自 open-ai-canvas `handler/logical_models.go` 的公开部分：
 *   · `GET  /models`            全量目录
 *   · `POST /models/available`  按请求意图筛选可用模型
 *   · `POST /models/:id/quote`  报价（不建任务、不扣费）
 *
 * 三个端点都用 `OptionalJwtAuthGuard`：未登录也能浏览目录（落地页、工作台
 * 首屏都要展示模型），登录后按会员分组过滤渠道并折算价格。**这些端点没有
 * 副作用**，把「可选身份」用在写接口上等于把接口暴露给匿名调用者。
 *
 * 意图入参统一走 `buildModelRequestIntent`：嵌套的 `inputs` / `options` 在
 * 全局 whitelist 下只能整体透传，形状校验必须在 controller 层先做掉。
 */

import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Allow, IsOptional, IsString } from 'class-validator';
import { OptionalJwtAuthGuard } from '../../common/optional-jwt-auth.guard';
import { buildModelRequestIntent } from '../intent/model-intent';
import type { ModelRequestIntent } from '../intent/spec-types';
import { UserGroupService } from '../user-groups/user-group.service';
import { CatalogService } from './catalog.service';
import { QuoteService } from './quote.service';

/** 模型意图入参：能力 + 可选的参考素材数量与模型参数 */
export class ModelIntentBodyDto {
  @IsOptional() @IsString() capability?: string;
  @IsOptional() @IsString() operation?: string;
  @IsOptional() @Allow() inputs?: unknown;
  @IsOptional() @Allow() options?: unknown;
}

function toIntent(body: ModelIntentBodyDto | undefined): ModelRequestIntent {
  return buildModelRequestIntent({
    capability: body?.capability,
    operation: body?.operation,
    inputs: body?.inputs,
    options: body?.options,
  });
}

@Controller('models')
@UseGuards(OptionalJwtAuthGuard)
export class ModelsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly quotes: QuoteService,
    private readonly groups: UserGroupService,
  ) {}

  /** 全量公开目录；登录用户按会员分组投影 */
  @Get()
  async list(@Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    return { models: await this.catalog.publicModels(access) };
  }

  /**
   * 按意图筛选：只返回「这组参数现在真的能跑」的模型。
   * 与工作台表单的联动靠这里 —— 不匹配的模型不下发，前端不需要再做猜算。
   */
  @Post('available')
  async available(@Body() body: ModelIntentBodyDto, @Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    return { models: await this.catalog.publicModels(access, toIntent(body)) };
  }

  /** 报价：返回该模型此组参数的应付积分，`estimated` 表示尚未结算 */
  @Post(':id/quote')
  async quote(@Param('id') id: string, @Body() body: ModelIntentBodyDto, @Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    return { quote: await this.quotes.quoteLogicalModel(access, id, toIntent(body)) };
  }
}
