/**
 * 后台渠道与渠道模型接口（`/api/v1/admin/channels`）。
 *
 * 路由顺序有意如此：静态段（`order` / `export` / `import` / `channel-models`）
 * 必须排在 `:id` 之前，否则 `GET /admin/channels/order` 会被当成渠道 id 命中。
 *
 * 入参只做「形状」校验收口到 service：白名单已经打开了 whitelist，
 * 因此嵌套字段（能力合同、价格档、请求头）必须显式声明为可透传，
 * 具体语义校验由 `ChannelService` / `ChannelModelService` 完成。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AdminUser, AuditAction, RequirePermission } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { ProtocolCatalogService } from '../protocol/protocol-catalog.service';
import { ProtocolTestService, type ProtocolTestRequest } from '../protocol/protocol-test.service';
import { ModelCatalogService } from '../catalog/model-catalog.service';
import { ChannelModelService } from './channel-model.service';
import { ChannelService } from './channel.service';
import { ChannelHealthService } from './channel-health.service';
import {
  MAX_CHANNEL_CONCURRENCY,
  MAX_SORT_ORDER,
  MIN_CHANNEL_CONCURRENCY,
  type ChannelModelRequest,
  type ChannelRequest,
  type SystemChannelExport,
} from './channel.types';

/** 渠道创建 / 更新入参 */
export class ChannelWriteBodyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_SORT_ORDER) sortOrder?: number | null;
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() secretKey?: string;
  @IsOptional() @IsInt() @Min(MIN_CHANNEL_CONCURRENCY) @Max(MAX_CHANNEL_CONCURRENCY) concurrencyLimit?: number | null;
  @IsOptional() @IsBoolean() useGlobalConcurrency?: boolean | null;
  @IsOptional() @IsArray() @IsString({ each: true }) models?: string[] | null;
  @IsOptional() @Allow() headers?: unknown;
  @IsOptional() @IsBoolean() enabled?: boolean | null;
  @IsOptional() @IsString() proxyUrl?: string | null;
  /** 高危动作原因（写审计） */
  @IsOptional() @IsString() reason?: string;
}

/** 渠道模型创建 / 更新入参 */
export class ChannelModelWriteBodyDto {
  @IsOptional() @IsString() modelKey?: string;
  @IsOptional() @IsString() providerModelKey?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() channelLabel?: string;
  @IsOptional() @Allow() tags?: unknown;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() capability?: string;
  @IsOptional() @IsString() protocol?: string;
  @IsOptional() @IsString() billingMode?: string;
  @IsOptional() @Allow() unitPriceMicrocredits?: number | string;
  @IsOptional() @Allow() inputTokenPriceMicrocredits?: number | string;
  @IsOptional() @Allow() outputTokenPriceMicrocredits?: number | string;
  @IsOptional() @Allow() cachedTokenPriceMicrocredits?: number | string;
  @IsOptional() @IsBoolean() priceConfigured?: boolean;
  @IsOptional() @IsString() priceCurrency?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean | null;
  @IsOptional() @Allow() capabilityConfig?: unknown;
  @IsOptional() @IsArray() priceTiers?: unknown[];
  @IsOptional() @IsString() reason?: string;
}

/** 渠道模型连通性测试入参（可带未保存的表单草稿） */
export class ChannelModelTestBodyDto {
  /** 已保存模型 id；给出时未填字段以库内配置为准 */
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsString() modelKey?: string;
  @IsOptional() @IsString() providerModelKey?: string;
  @IsOptional() @IsString() capability?: string;
  @IsOptional() @IsString() protocol?: string;
  @IsOptional() @Allow() capabilityConfig?: unknown;
  /** 异步协议是否等待结果；默认 true */
  @IsOptional() @IsBoolean() waitForResult?: boolean;
  @IsOptional() @IsInt() @Min(1000) @Max(10 * 60 * 1000) timeoutMs?: number;
  /** 高危动作原因（写审计） */
  @IsOptional() @IsString() reason?: string;
}

/** 上游目录导入入参：只导入管理员明确勾选的模型 */
export class ChannelModelImportBodyDto {
  @IsArray() @IsString({ each: true }) models!: string[];
  /** 高危动作原因（写审计） */
  @IsOptional() @IsString() reason?: string;
}

export class ChannelEnabledBodyDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() reason?: string;
}

export class ChannelSortBodyDto {
  @IsInt() @Min(0) @Max(MAX_SORT_ORDER) sortOrder!: number;
  @IsOptional() @IsString() reason?: string;
}

export class ChannelBatchDeleteBodyDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsString() reason?: string;
}

/** 单条渠道删除：DELETE 也允许带原因，审计要能回答「为什么删」 */
export class ChannelDeleteBodyDto {
  @IsOptional() @IsString() reason?: string;
}

/** 单条渠道模型删除：DELETE 也允许带原因，审计要能回答「为什么删」 */
export class ChannelModelDeleteBodyDto {
  @IsOptional() @IsString() reason?: string;
}

export class ChannelOrderBodyDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsArray() @IsString({ each: true }) expectedIds!: string[];
  @IsOptional() @IsString() reason?: string;
}

export class ChannelExportBodyDto {
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
  @IsOptional() @IsString() reason?: string;
}

/** 导入文件即导出文件本身，允许附带 reason */
export class ChannelImportBodyDto {
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsInt() version?: number;
  @IsOptional() @IsArray() channels?: unknown[];
  @IsOptional() @IsObject() @Allow() exportedAt?: unknown;
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin/channels')
export class AdminChannelsController {
  constructor(
    private readonly channels: ChannelService,
    private readonly channelModels: ChannelModelService,
    private readonly protocolTest: ProtocolTestService,
    private readonly catalog: ModelCatalogService,
    private readonly protocols: ProtocolCatalogService,
    private readonly health: ChannelHealthService,
  ) {}

  /* ── 渠道 ─────────────────────────────────────────────── */

  @Get()
  @RequirePermission(PERMISSIONS.channelRead)
  list(@Query('keyword') keyword?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.channels.list({
      keyword,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 静态路由必须排在 `:id` 之前 */
  @Get('order')
  @RequirePermission(PERMISSIONS.channelRead)
  order() {
    return this.channels.order('');
  }

  /**
   * 可选协议目录（渠道模型表单的协议来源，也用于保存期能力校验）。
   *
   * 必须排在 `:id` 之前：`protocols` 会被当成渠道 id 命中 `GET /admin/channels/:id`。
   * `capability` 由前端按所选能力过滤，避免把文本协议配进生图通道。
   */
  @Get('protocols')
  @RequirePermission(PERMISSIONS.channelModelRead)
  protocolCatalog(@Query('capability') capability?: string) {
    return { protocols: this.protocols.list(capability ? String(capability) : undefined) };
  }

  /**
   * 线路健康（一行 = 一条渠道模型）。
   *
   * 后台值班塔与排障入口读这里：冷却状态来自本进程的 `RouteHealthService`，
   * 与调度器判定用的是同一份数据，不另算一套。
   */
  @Get('health')
  @RequirePermission(PERMISSIONS.channelRead)
  async healthSnapshot() {
    return { items: await this.health.list() };
  }

  @Put('order')
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction('channel.order')
  async saveOrder(@Body() body: ChannelOrderBodyDto) {
    await this.channels.saveOrder('', body.ids ?? [], body.expectedIds ?? []);
    return { ok: true };
  }

  @Post('export')
  @RequirePermission(PERMISSIONS.channelRead)
  @AuditAction('channel.export')
  export(@Body() body: ChannelExportBodyDto) {
    return this.channels.exportChannels(body?.ids ?? []);
  }

  @Post('import')
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction('channel.import')
  import(@Body() body: ChannelImportBodyDto) {
    return this.channels.importChannels(body as unknown as SystemChannelExport);
  }

  @Post()
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction('channel.create')
  create(@Body() body: ChannelWriteBodyDto) {
    return this.channels.create(body as ChannelRequest);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.channelRead)
  get(@Param('id') id: string) {
    return this.channels.get(id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction('channel.update')
  update(@Param('id') id: string, @Body() body: ChannelWriteBodyDto) {
    return this.channels.update(id, body as ChannelRequest);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction('channel.delete')
  async remove(@Param('id') id: string, @Body() body: ChannelDeleteBodyDto) {
    // 原因只进审计（AuditInterceptor 读 body.reason），不回显给前端
    await this.channels.remove(id);
    return { ok: true };
  }

  @Post(':id/duplicate')
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction('channel.duplicate')
  duplicate(@Param('id') id: string) {
    return this.channels.duplicate(id);
  }

  /* ── 渠道模型 ─────────────────────────────────────────── */

  @Get(':id/models')
  @RequirePermission(PERMISSIONS.channelModelRead)
  models(@Param('id') id: string) {
    return this.channelModels.list(id);
  }

  @Get(':id/models/order')
  @RequirePermission(PERMISSIONS.channelModelRead)
  modelOrder(@Param('id') id: string) {
    return this.channels.order(id);
  }

  @Put(':id/models/order')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.order')
  async saveModelOrder(@Param('id') id: string, @Body() body: ChannelOrderBodyDto) {
    await this.channels.saveOrder(id, body.ids ?? [], body.expectedIds ?? []);
    return { ok: true };
  }

  @Post(':id/models')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.create')
  createModel(@Param('id') id: string, @Body() body: ChannelModelWriteBodyDto) {
    return this.channelModels.save(id, '', body as ChannelModelRequest);
  }

  /**
   * 读取上游模型目录（只读，不写库）。用渠道已保存的凭证在服务端发起请求，
   * 密钥不经过浏览器。
   */
  @Post(':id/models/fetch')
  @RequirePermission(PERMISSIONS.channelModelRead)
  @AuditAction('channel_model.fetch')
  async fetchModels(@Param('id') id: string) {
    return { models: await this.catalog.preview(id) };
  }

  /** 导入勾选的上游模型：默认停用、待定价；能力与协议仍需管理员声明 */
  @Post(':id/models/import')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.import')
  importModels(@Param('id') id: string, @Body() body: ChannelModelImportBodyDto) {
    return this.catalog.import(id, body.models ?? []);
  }

  @Patch(':id/models/:modelId')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.update')
  updateModel(@Param('id') id: string, @Param('modelId') modelId: string, @Body() body: ChannelModelWriteBodyDto) {
    return this.channelModels.save(id, modelId, body as ChannelModelRequest);
  }

  @Delete(':id/models/:modelId')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.delete')
  async removeModel(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body() body: ChannelModelDeleteBodyDto,
  ) {
    // 原因只进审计（AuditInterceptor 读 body.reason），不回显给前端
    const deleted = await this.channelModels.removeMany(id, [modelId]);
    return { deleted };
  }

  @Post(':id/models/batch-delete')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.batch_delete')
  async batchDeleteModels(@Param('id') id: string, @Body() body: ChannelBatchDeleteBodyDto) {
    const deleted = await this.channelModels.removeMany(id, body.ids ?? []);
    return { deleted };
  }

  /**
   * 连通性测试：用渠道真实凭证发一次最小请求。
   *
   * 走的是与正式任务完全相同的协议、出站策略与鉴权，唯一区别是不建任务、
   * 不扣费；结果同时落 `ApiCallLog`（`billable=false`），后台「调用记录」
   * 页据此展示。可测未保存的模型草稿，因此入参允许携带表单当前值。
   */
  @Post(':id/models/test')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.test')
  testModel(@Param('id') id: string, @Body() body: ChannelModelTestBodyDto, @AdminUser() user: AdminUser) {
    return this.protocolTest.test(id, body as ProtocolTestRequest, user?.id ?? 'unknown');
  }

  @Patch(':id/models/:modelId/enabled')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.enabled')
  async setModelEnabled(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body() body: ChannelEnabledBodyDto,
  ) {
    await this.channelModels.setEnabled(id, modelId, body.enabled);
    return { ok: true };
  }

  @Patch(':id/models/:modelId/sort')
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction('channel_model.sort')
  async setModelSort(@Param('id') id: string, @Param('modelId') modelId: string, @Body() body: ChannelSortBodyDto) {
    await this.channelModels.updateSort(id, modelId, body.sortOrder);
    return { ok: true };
  }
}

/** 全量渠道模型（跨渠道只读视图） */
@Controller('admin/channel-models')
export class AdminChannelModelsController {
  constructor(private readonly channelModels: ChannelModelService) {}

  @Get()
  @RequirePermission(PERMISSIONS.channelModelRead)
  list(@Query('channelId') channelId?: string) {
    return this.channelModels.listAll(channelId ? String(channelId) : undefined);
  }
}
