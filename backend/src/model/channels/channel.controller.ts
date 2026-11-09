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
} from "@nestjs/common";
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
} from "class-validator";
import {
  AdminUser,
  AuditAction,
  AuditTarget,
  RequireAllPermissions,
  RequirePermission,
} from "../../admin/admin.decorator";
import { AppError } from "../../common/app.exception";
import {
  RateLimit,
  type RateLimitOptions,
} from "../../common/rate-limit.guard";
import { PERMISSIONS } from "../../admin/permissions";
import { ProtocolCatalogService } from "../protocol/protocol-catalog.service";
import {
  ProtocolTestService,
  type ProtocolTestRequest,
} from "../protocol/protocol-test.service";
import { ModelCatalogService } from "../catalog/model-catalog.service";
import { ChannelModelService } from "./channel-model.service";
import { ChannelService } from "./channel.service";
import { ChannelHealthService } from "./channel-health.service";
import { ChannelModelMetricsService } from "./channel-model-metrics.service";
import {
  MAX_CHANNEL_CONCURRENCY,
  MAX_SORT_ORDER,
  MIN_CHANNEL_CONCURRENCY,
  type ChannelModelRequest,
  type ChannelRequest,
  type SystemChannelExport,
} from "./channel.types";

/** 渠道创建 / 更新入参 */
export class ChannelWriteBodyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_SORT_ORDER) sortOrder?: number | null;
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() secretKey?: string;
  @IsOptional()
  @IsInt()
  @Min(MIN_CHANNEL_CONCURRENCY)
  @Max(MAX_CHANNEL_CONCURRENCY)
  concurrencyLimit?: number | null;
  @IsOptional() @IsBoolean() useGlobalConcurrency?: boolean | null;
  @IsOptional() @IsArray() @IsString({ each: true }) models?: string[] | null;
  @IsOptional() @Allow() headers?: unknown;
  @IsOptional() @IsBoolean() enabled?: boolean | null;
  @IsOptional() @IsString() proxyUrl?: string | null;
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
}

/** 上游目录导入入参：只导入管理员明确勾选的模型 */
export class ChannelModelImportBodyDto {
  @IsArray() @IsString({ each: true }) models!: string[];
}

export class ChannelEnabledBodyDto {
  @IsBoolean() enabled!: boolean;
}

export class ChannelSortBodyDto {
  @IsInt() @Min(0) @Max(MAX_SORT_ORDER) sortOrder!: number;
}

export class ChannelBatchDeleteBodyDto {
  /**
   * 待删除的渠道模型 id 列表。
   *
   * 兼容两个字段名：`ids`（本仓）与 `modelIds`（参考实现 open-ai-canvas）。
   * 两个都缺才报错 —— 迁移过来的脚本按 `modelIds` 提交不该被 400 挡下。
   */
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) modelIds?: string[];

  /** 归一化后的 id 列表（两个别名取并集去重） */
  targets(): string[] {
    return [
      ...new Set(
        [...(this.ids ?? []), ...(this.modelIds ?? [])]
          .map((v) => String(v ?? "").trim())
          .filter((v) => v !== ""),
      ),
    ];
  }
}

/** 批量调价入参；嵌套结构由 `ChannelModelService.repriceMany` 逐项校验 */
export class ChannelModelRepriceBodyDto {
  @IsArray() models!: unknown[];
}

export class ChannelOrderBodyDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsArray() @IsString({ each: true }) expectedIds!: string[];
}

export class ChannelExportBodyDto {
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
}

/*
 * 会真实调用上游的三个端点必须限流。
 *
 * 拉取目录 / 导入模型 / 连通性测试都会用**渠道里的真实凭证**打上游，
 * 每次调用都产生供应商成本并占用上游并发槽。没有限流时，
 * 拿到 `channel.model_write` 的账号可以把它当刷上游的通道 ——
 * 与 `/ai/models` 已有的 30 次/分保护自相矛盾。
 *
 * 配额与参考实现一致（open-ai-canvas `handler/finance.go`）：
 * fetch/import 各 10 次/分，test 5 次/分，均按用户维度。
 */
const RL_CHANNEL_FETCH: RateLimitOptions = {
  name: "channel-model-fetch",
  limit: 10,
  windowSec: 60,
  scope: "user",
};

const RL_CHANNEL_IMPORT: RateLimitOptions = {
  name: "channel-model-import",
  limit: 10,
  windowSec: 60,
  scope: "user",
};

const RL_CHANNEL_TEST: RateLimitOptions = {
  name: "channel-model-test",
  limit: 5,
  windowSec: 60,
  scope: "user",
};

/** 导入文件即导出文件本身 */
export class ChannelImportBodyDto {
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsInt() version?: number;
  @IsOptional() @IsArray() channels?: unknown[];
  @IsOptional() @IsObject() @Allow() exportedAt?: unknown;
}

@Controller("admin/channels")
export class AdminChannelsController {
  constructor(
    private readonly channels: ChannelService,
    private readonly channelModels: ChannelModelService,
    private readonly protocolTest: ProtocolTestService,
    private readonly catalog: ModelCatalogService,
    private readonly protocols: ProtocolCatalogService,
    private readonly health: ChannelHealthService,
    private readonly metrics: ChannelModelMetricsService,
  ) {}

  /* ── 渠道 ─────────────────────────────────────────────── */

  @Get()
  @RequirePermission(PERMISSIONS.channelRead)
  list(
    @Query("keyword") keyword?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.channels.list({
      keyword,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 静态路由必须排在 `:id` 之前 */
  @Get("order")
  @RequirePermission(PERMISSIONS.channelRead)
  async order() {
    // 包裹成 { items }：与参考实现的路由顺序端点契约一致，
    // 前端读 .items 而不是裸数组。
    //
    // 必须 await：`{ items: promise }` 会被 JSON 序列化成 `{"items":{}}`，
    // 前端拿到空对象后再 .map 就是「Cannot read properties of undefined」。
    return { items: await this.channels.order("") };
  }

  /**
   * 可选协议目录（渠道模型表单的协议来源，也用于保存期能力校验）。
   *
   * 必须排在 `:id` 之前：`protocols` 会被当成渠道 id 命中 `GET /admin/channels/:id`。
   * `capability` 由前端按所选能力过滤，避免把文本协议配进生图通道。
   */
  @Get("protocols")
  @RequirePermission(PERMISSIONS.channelModelRead)
  protocolCatalog(@Query("capability") capability?: string) {
    return {
      protocols: this.protocols.list(
        capability ? String(capability) : undefined,
      ),
    };
  }

  /**
   * 线路健康（一行 = 一条渠道模型）。
   *
   * 后台值班塔与排障入口读这里：冷却状态来自本进程的 `RouteHealthService`，
   * 与调度器判定用的是同一份数据，不另算一套。
   */
  @Get("health")
  @RequirePermission(PERMISSIONS.channelRead)
  async healthSnapshot() {
    return { items: await this.health.list() };
  }

  /**
   * 解除本进程内全部线路冷却。
   *
   * 冷却只在 401/403/404/429 这类明确可归因的失败上写入，正常情况下等它自然
   * 到期即可。运维确认上游已恢复后手动解除，省掉「改完配置还要再等十分钟」。
   * 多实例部署时只影响处理本次请求的实例，与冷却的进程内语义一致。
   */
  @Post("health/reset")
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.health_reset")
  @AuditTarget("channel")
  async resetHealth() {
    const cleared = this.health.resetCooling();
    // 指标列表缓存 30s，里面带着冷却快照；不失效的话刚解除完页面还会显示「冷却中」
    this.metrics.invalidate();
    return { cleared };
  }

  @Put("order")
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.order")
  @AuditTarget("channel")
  async saveOrder(@Body() body: ChannelOrderBodyDto) {
    await this.channels.saveOrder("", body.ids ?? [], body.expectedIds ?? []);
    return { ok: true };
  }

  @Post("export")
  @RequireAllPermissions(PERMISSIONS.channelRead, PERMISSIONS.dataExport)
  @AuditAction("channel.export")
  @AuditTarget("channel")
  export(@Body() body: ChannelExportBodyDto) {
    return this.channels.exportChannels(body?.ids ?? []);
  }

  @Post("import")
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.import")
  @AuditTarget("channel")
  import(@Body() body: ChannelImportBodyDto) {
    return this.channels.importChannels(body as unknown as SystemChannelExport);
  }

  @Post()
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.create")
  @AuditTarget("channel")
  create(@Body() body: ChannelWriteBodyDto) {
    return this.channels.create(body as ChannelRequest);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.channelRead)
  get(@Param("id") id: string) {
    return this.channels.get(id);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.update")
  @AuditTarget("channel", "id")
  update(@Param("id") id: string, @Body() body: ChannelWriteBodyDto) {
    return this.channels.update(id, body as ChannelRequest);
  }

  @Delete(":id")
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.delete")
  @AuditTarget("channel", "id")
  async remove(@Param("id") id: string) {
    await this.channels.remove(id);
    return { ok: true };
  }

  @Post(":id/duplicate")
  @RequirePermission(PERMISSIONS.channelWrite)
  @AuditAction("channel.duplicate")
  @AuditTarget("channel", "id")
  duplicate(@Param("id") id: string, @AdminUser() actor: AdminUser) {
    // 归属人写进渠道：复制出的渠道要能查到「是谁建的」
    return this.channels.duplicate(id, actor?.id ?? "");
  }

  /* ── 渠道模型 ─────────────────────────────────────────── */

  @Get(":id/models")
  @RequirePermission(PERMISSIONS.channelModelRead)
  async models(@Param("id") id: string) {
    // 包裹成 { models }：与参考实现契约一致，前端读 .models
    // 必须 await，否则序列化成 `{"models":{}}`。
    return { models: await this.channelModels.list(id) };
  }

  @Get(":id/models/order")
  @RequirePermission(PERMISSIONS.channelModelRead)
  async modelOrder(@Param("id") id: string) {
    return { items: await this.channels.order(id) };
  }

  @Put(":id/models/order")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.order")
  @AuditTarget("channel", "id")
  async saveModelOrder(
    @Param("id") id: string,
    @Body() body: ChannelOrderBodyDto,
  ) {
    await this.channels.saveOrder(id, body.ids ?? [], body.expectedIds ?? []);
    return { ok: true };
  }

  @Post(":id/models")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.create")
  @AuditTarget("channel", "id")
  createModel(@Param("id") id: string, @Body() body: ChannelModelWriteBodyDto) {
    return this.channelModels.save(id, "", body as ChannelModelRequest);
  }

  /**
   * 读取上游模型目录（只读，不写库）。用渠道已保存的凭证在服务端发起请求，
   * 密钥不经过浏览器。
   */
  @Post(":id/models/fetch")
  @RequirePermission(PERMISSIONS.channelModelRead)
  @AuditAction("channel_model.fetch")
  @AuditTarget("channel", "id")
  @RateLimit(RL_CHANNEL_FETCH)
  async fetchModels(@Param("id") id: string) {
    return { models: await this.catalog.preview(id) };
  }

  /** 导入勾选的上游模型：默认停用、待定价；能力与协议仍需管理员声明 */
  @Post(":id/models/import")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.import")
  @AuditTarget("channel", "id")
  @RateLimit(RL_CHANNEL_IMPORT)
  importModels(
    @Param("id") id: string,
    @Body() body: ChannelModelImportBodyDto,
  ) {
    return this.catalog.import(id, body.models ?? []);
  }

  @Patch(":id/models/:modelId")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.update")
  @AuditTarget("channel_model", "modelId")
  updateModel(
    @Param("id") id: string,
    @Param("modelId") modelId: string,
    @Body() body: ChannelModelWriteBodyDto,
  ) {
    return this.channelModels.save(id, modelId, body as ChannelModelRequest);
  }

  @Delete(":id/models/:modelId")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.delete")
  @AuditTarget("channel_model", "modelId")
  async removeModel(
    @Param("id") id: string,
    @Param("modelId") modelId: string,
  ) {
    const deleted = await this.channelModels.removeMany(id, [modelId]);
    return { ok: true, deleted };
  }

  @Post(":id/models/batch-delete")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.batch_delete")
  @AuditTarget("channel", "id")
  async batchDeleteModels(
    @Param("id") id: string,
    @Body() body: ChannelBatchDeleteBodyDto,
  ) {
    const targets = body.targets();
    if (targets.length === 0) {
      throw new AppError(40001, "请选择要删除的渠道模型", 400);
    }
    const deleted = await this.channelModels.removeMany(id, targets);
    // 同时给出 ok 与 deleted：参考实现读 ok，本仓前端读 deleted
    return { ok: true, deleted };
  }

  /**
   * 批量调价：前端按「成本 × (1 + 加价率)」算好最终售价后提交。
   * 价格版本不一致（期间有人改过价）时整批拒绝，不部分落库。
   */
  @Post(":id/models/batch-reprice")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.batch_reprice")
  @AuditTarget("channel", "id")
  async batchRepriceModels(
    @Param("id") id: string,
    @Body() body: ChannelModelRepriceBodyDto,
  ) {
    const updated = await this.channelModels.repriceMany(id, body.models ?? []);
    return { updated };
  }

  /**
   * 连通性测试：用渠道真实凭证发一次最小请求。
   *
   * 走的是与正式任务完全相同的协议、出站策略与鉴权，唯一区别是不建任务、
   * 不扣费；结果同时落 `ApiCallLog`（`billable=false`），后台「调用记录」
   * 页据此展示。可测未保存的模型草稿，因此入参允许携带表单当前值。
   */
  @Post(":id/models/test")
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction("channel_model.test")
  @AuditTarget("channel", "id")
  @RateLimit(RL_CHANNEL_TEST)
  testModel(
    @Param("id") id: string,
    @Body() body: ChannelModelTestBodyDto,
    @AdminUser() user: AdminUser,
  ) {
    return this.protocolTest.test(
      id,
      body as ProtocolTestRequest,
      user?.id ?? "unknown",
    );
  }

  @Patch(":id/models/:modelId/enabled")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.enabled")
  @AuditTarget("channel_model", "modelId")
  async setModelEnabled(
    @Param("id") id: string,
    @Param("modelId") modelId: string,
    @Body() body: ChannelEnabledBodyDto,
  ) {
    await this.channelModels.setEnabled(id, modelId, body.enabled);
    return { ok: true };
  }

  @Patch(":id/models/:modelId/sort")
  @RequirePermission(PERMISSIONS.channelModelWrite)
  @AuditAction("channel_model.sort")
  @AuditTarget("channel_model", "modelId")
  async setModelSort(
    @Param("id") id: string,
    @Param("modelId") modelId: string,
    @Body() body: ChannelSortBodyDto,
  ) {
    await this.channelModels.updateSort(id, modelId, body.sortOrder);
    return { ok: true };
  }
}

/** 全量渠道模型（跨渠道只读视图） */
@Controller("admin/channel-models")
export class AdminChannelModelsController {
  constructor(
    private readonly channelModels: ChannelModelService,
    private readonly metrics: ChannelModelMetricsService,
  ) {}

  /**
   * 跨渠道模型列表。
   *
   * `includeDisabled=1` 时含已停用的模型（后台「全部模型」视图用 —— 那里
   * 要能看到并重新启用停用项）；默认只给启用的模型（前台模型的线路选择器
   * 用 —— 停用线路进了下拉会让人以为「选了就能用」）。
   */
  @Get()
  @RequirePermission(PERMISSIONS.channelModelRead)
  async list(
    @Query("channelId") channelId?: string,
    @Query("includeDisabled") includeDisabled?: string,
  ) {
    // 包裹成 { models }：与参考实现契约一致，前端读 .models
    // 必须 await，否则序列化成 `{"models":{}}`。
    return {
      models: await this.channelModels.listAll(
        channelId ? String(channelId) : undefined,
        String(includeDisabled ?? "") === "1",
      ),
    };
  }

  /**
   * 线路健康指标（24h / 7d 成功率、P95、最近样本）。
   *
   * 与 `/admin/channels/health` 的区别：后者是**当前状态**（启停 / 协议 /
   * 冷却），本端点是**历史表现**（成功率 / 耗时）。值班时两个都要看 ——
   * 「现在没冷却但 24h 成功率 40%」和「现在冷却中但 7d 成功率 99%」
   * 要做的动作完全不同。
   */
  @Get("health")
  @RequirePermission(PERMISSIONS.channelModelRead)
  async health(@Query("channelId") channelId?: string) {
    return {
      items: await this.metrics.list(channelId ? String(channelId) : undefined),
    };
  }
}
