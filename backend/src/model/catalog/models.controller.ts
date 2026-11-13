/**
 * 能力模型目录（`/api/v1/models`）。
 *
 * 前台模型层删除后，目录按「能力 + 模型分组」下发：
 *   · `GET  /models?capability=`  某能力的模型分组（缺省返回全部）
 *   · `POST /models/available`    按参数组合筛选当前真能跑的分组
 *   · `POST /models/quote`        报价（不建任务、不扣费）
 *
 * 三个端点都用 `OptionalJwtAuthGuard`：未登录也能浏览目录，登录后按会员分组
 * 过滤渠道并折算价格。**这些端点没有副作用**。
 */

import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Allow, IsOptional, IsString } from 'class-validator';
import { OptionalJwtAuthGuard } from '../../common/optional-jwt-auth.guard';
import { buildModelRequestIntent } from '../intent/model-intent';
import { getCapability } from '../../capabilities/capability.registry';
import type { ModelRequestIntent } from '../intent/spec-types';
import { UserGroupService } from '../user-groups/user-group.service';
import { CatalogService } from './catalog.service';
import { QuoteService } from './quote.service';

/** 模型意图入参：能力 + 可选的参考素材数量与模型参数 */
export class ModelIntentBodyDto {
  @IsOptional() @IsString() capability?: string;
  @IsOptional() @IsString() modelKey?: string;
  @IsOptional() @IsString() operation?: string;
  @IsOptional() @Allow() inputs?: unknown;
  @IsOptional() @Allow() options?: unknown;
}

function toIntent(body: ModelIntentBodyDto | undefined, abilityId?: string): ModelRequestIntent {
  // 入参 `capability` 对目录接口是产品能力 id；能力合同匹配要用产出模态
  const modality = abilityId
    ? getCapability(String(abilityId ?? '').trim())?.model?.capability
    : body?.capability;
  return buildModelRequestIntent({
    capability: modality,
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

  /**
   * 模型分组目录。
   *
   * `capability` 缺省时返回全部能力的分组，供工作台首屏一次取回；
   * 单能力页传 `capability`，避免拉全量。
   */
  @Get()
  async list(
    @Query('capability') capability: string | undefined,
    @Req() req: { user?: { id: string } },
  ) {
    const access = await this.groups.accessForUser(req.user?.id);
    const models = capability
      ? await this.catalog.publicGroups(access, capability)
      : await this.catalog.publicAll(access);
    return { models };
  }

  /** 按意图筛选：只返回「这组参数现在真的能跑」的分组 */
  @Post('available')
  async available(@Body() body: ModelIntentBodyDto, @Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    const capability = String(body?.capability ?? '').trim();
    if (!capability) return { models: [] };
    return { models: await this.catalog.publicGroups(access, capability, toIntent(body, capability)) };
  }

  /** 报价：返回该能力此组参数的应付积分 */
  @Post('quote')
  async quote(@Body() body: ModelIntentBodyDto, @Req() req: { user?: { id: string } }) {
    const access = await this.groups.accessForUser(req.user?.id);
    const capability = String(body?.capability ?? '').trim();
    if (!capability) return { quote: null };
    return {
      quote: await this.quotes.quoteCapability(
        access,
        capability,
        String(body?.modelKey ?? '').trim(),
        toIntent(body, capability),
        req.user?.id,
      ),
    };
  }
}
