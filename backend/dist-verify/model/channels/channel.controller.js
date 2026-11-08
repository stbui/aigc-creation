"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminChannelModelsController = exports.AdminChannelsController = exports.ChannelImportBodyDto = exports.ChannelExportBodyDto = exports.ChannelOrderBodyDto = exports.ChannelModelRepriceBodyDto = exports.ChannelBatchDeleteBodyDto = exports.ChannelSortBodyDto = exports.ChannelEnabledBodyDto = exports.ChannelModelImportBodyDto = exports.ChannelModelTestBodyDto = exports.ChannelModelWriteBodyDto = exports.ChannelWriteBodyDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("../../admin/admin.decorator");
const app_exception_1 = require("../../common/app.exception");
const rate_limit_guard_1 = require("../../common/rate-limit.guard");
const permissions_1 = require("../../admin/permissions");
const protocol_catalog_service_1 = require("../protocol/protocol-catalog.service");
const protocol_test_service_1 = require("../protocol/protocol-test.service");
const model_catalog_service_1 = require("../catalog/model-catalog.service");
const channel_model_service_1 = require("./channel-model.service");
const channel_service_1 = require("./channel.service");
const channel_health_service_1 = require("./channel-health.service");
const channel_model_metrics_service_1 = require("./channel-model-metrics.service");
const channel_types_1 = require("./channel.types");
/** 渠道创建 / 更新入参 */
class ChannelWriteBodyDto {
}
exports.ChannelWriteBodyDto = ChannelWriteBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelWriteBodyDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(channel_types_1.MAX_SORT_ORDER),
    __metadata("design:type", Number)
], ChannelWriteBodyDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelWriteBodyDto.prototype, "baseUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelWriteBodyDto.prototype, "apiKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelWriteBodyDto.prototype, "secretKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(channel_types_1.MIN_CHANNEL_CONCURRENCY),
    (0, class_validator_1.Max)(channel_types_1.MAX_CHANNEL_CONCURRENCY),
    __metadata("design:type", Number)
], ChannelWriteBodyDto.prototype, "concurrencyLimit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelWriteBodyDto.prototype, "useGlobalConcurrency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelWriteBodyDto.prototype, "models", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelWriteBodyDto.prototype, "headers", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelWriteBodyDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelWriteBodyDto.prototype, "proxyUrl", void 0);
/** 渠道模型创建 / 更新入参 */
class ChannelModelWriteBodyDto {
}
exports.ChannelModelWriteBodyDto = ChannelModelWriteBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "modelKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "providerModelKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "displayName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "channelLabel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelWriteBodyDto.prototype, "tags", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "icon", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "protocol", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "billingMode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelWriteBodyDto.prototype, "unitPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelWriteBodyDto.prototype, "inputTokenPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelWriteBodyDto.prototype, "outputTokenPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelWriteBodyDto.prototype, "cachedTokenPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelModelWriteBodyDto.prototype, "priceConfigured", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelWriteBodyDto.prototype, "priceCurrency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelModelWriteBodyDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelWriteBodyDto.prototype, "capabilityConfig", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], ChannelModelWriteBodyDto.prototype, "priceTiers", void 0);
/** 渠道模型连通性测试入参（可带未保存的表单草稿） */
class ChannelModelTestBodyDto {
}
exports.ChannelModelTestBodyDto = ChannelModelTestBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelTestBodyDto.prototype, "modelId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelTestBodyDto.prototype, "modelKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelTestBodyDto.prototype, "providerModelKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelTestBodyDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelTestBodyDto.prototype, "protocol", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelModelTestBodyDto.prototype, "capabilityConfig", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelModelTestBodyDto.prototype, "waitForResult", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1000),
    (0, class_validator_1.Max)(10 * 60 * 1000),
    __metadata("design:type", Number)
], ChannelModelTestBodyDto.prototype, "timeoutMs", void 0);
/** 上游目录导入入参：只导入管理员明确勾选的模型 */
class ChannelModelImportBodyDto {
}
exports.ChannelModelImportBodyDto = ChannelModelImportBodyDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelModelImportBodyDto.prototype, "models", void 0);
class ChannelEnabledBodyDto {
}
exports.ChannelEnabledBodyDto = ChannelEnabledBodyDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelEnabledBodyDto.prototype, "enabled", void 0);
class ChannelSortBodyDto {
}
exports.ChannelSortBodyDto = ChannelSortBodyDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(channel_types_1.MAX_SORT_ORDER),
    __metadata("design:type", Number)
], ChannelSortBodyDto.prototype, "sortOrder", void 0);
class ChannelBatchDeleteBodyDto {
    /** 归一化后的 id 列表（两个别名取并集去重） */
    targets() {
        return [
            ...new Set([...(this.ids ?? []), ...(this.modelIds ?? [])]
                .map((v) => String(v ?? "").trim())
                .filter((v) => v !== "")),
        ];
    }
}
exports.ChannelBatchDeleteBodyDto = ChannelBatchDeleteBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelBatchDeleteBodyDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelBatchDeleteBodyDto.prototype, "modelIds", void 0);
/** 批量调价入参；嵌套结构由 `ChannelModelService.repriceMany` 逐项校验 */
class ChannelModelRepriceBodyDto {
}
exports.ChannelModelRepriceBodyDto = ChannelModelRepriceBodyDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], ChannelModelRepriceBodyDto.prototype, "models", void 0);
class ChannelOrderBodyDto {
}
exports.ChannelOrderBodyDto = ChannelOrderBodyDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelOrderBodyDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelOrderBodyDto.prototype, "expectedIds", void 0);
class ChannelExportBodyDto {
}
exports.ChannelExportBodyDto = ChannelExportBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ChannelExportBodyDto.prototype, "ids", void 0);
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
const RL_CHANNEL_FETCH = {
    name: "channel-model-fetch",
    limit: 10,
    windowSec: 60,
    scope: "user",
};
const RL_CHANNEL_IMPORT = {
    name: "channel-model-import",
    limit: 10,
    windowSec: 60,
    scope: "user",
};
const RL_CHANNEL_TEST = {
    name: "channel-model-test",
    limit: 5,
    windowSec: 60,
    scope: "user",
};
/** 导入文件即导出文件本身 */
class ChannelImportBodyDto {
}
exports.ChannelImportBodyDto = ChannelImportBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelImportBodyDto.prototype, "format", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], ChannelImportBodyDto.prototype, "version", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], ChannelImportBodyDto.prototype, "channels", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ChannelImportBodyDto.prototype, "exportedAt", void 0);
let AdminChannelsController = class AdminChannelsController {
    constructor(channels, channelModels, protocolTest, catalog, protocols, health) {
        this.channels = channels;
        this.channelModels = channelModels;
        this.protocolTest = protocolTest;
        this.catalog = catalog;
        this.protocols = protocols;
        this.health = health;
    }
    /* ── 渠道 ─────────────────────────────────────────────── */
    list(keyword, status, page, limit) {
        return this.channels.list({
            keyword,
            status,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }
    /** 静态路由必须排在 `:id` 之前 */
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
    protocolCatalog(capability) {
        return {
            protocols: this.protocols.list(capability ? String(capability) : undefined),
        };
    }
    /**
     * 线路健康（一行 = 一条渠道模型）。
     *
     * 后台值班塔与排障入口读这里：冷却状态来自本进程的 `RouteHealthService`，
     * 与调度器判定用的是同一份数据，不另算一套。
     */
    async healthSnapshot() {
        return { items: await this.health.list() };
    }
    async saveOrder(body) {
        await this.channels.saveOrder("", body.ids ?? [], body.expectedIds ?? []);
        return { ok: true };
    }
    export(body) {
        return this.channels.exportChannels(body?.ids ?? []);
    }
    import(body) {
        return this.channels.importChannels(body);
    }
    create(body) {
        return this.channels.create(body);
    }
    get(id) {
        return this.channels.get(id);
    }
    update(id, body) {
        return this.channels.update(id, body);
    }
    async remove(id) {
        await this.channels.remove(id);
        return { ok: true };
    }
    duplicate(id, actor) {
        // 归属人写进渠道：复制出的渠道要能查到「是谁建的」
        return this.channels.duplicate(id, actor?.id ?? "");
    }
    /* ── 渠道模型 ─────────────────────────────────────────── */
    async models(id) {
        // 包裹成 { models }：与参考实现契约一致，前端读 .models
        // 必须 await，否则序列化成 `{"models":{}}`。
        return { models: await this.channelModels.list(id) };
    }
    async modelOrder(id) {
        return { items: await this.channels.order(id) };
    }
    async saveModelOrder(id, body) {
        await this.channels.saveOrder(id, body.ids ?? [], body.expectedIds ?? []);
        return { ok: true };
    }
    createModel(id, body) {
        return this.channelModels.save(id, "", body);
    }
    /**
     * 读取上游模型目录（只读，不写库）。用渠道已保存的凭证在服务端发起请求，
     * 密钥不经过浏览器。
     */
    async fetchModels(id) {
        return { models: await this.catalog.preview(id) };
    }
    /** 导入勾选的上游模型：默认停用、待定价；能力与协议仍需管理员声明 */
    importModels(id, body) {
        return this.catalog.import(id, body.models ?? []);
    }
    updateModel(id, modelId, body) {
        return this.channelModels.save(id, modelId, body);
    }
    async removeModel(id, modelId) {
        const deleted = await this.channelModels.removeMany(id, [modelId]);
        return { ok: true, deleted };
    }
    async batchDeleteModels(id, body) {
        const targets = body.targets();
        if (targets.length === 0) {
            throw new app_exception_1.AppError(40001, "请选择要删除的渠道模型", 400);
        }
        const deleted = await this.channelModels.removeMany(id, targets);
        // 同时给出 ok 与 deleted：参考实现读 ok，本仓前端读 deleted
        return { ok: true, deleted };
    }
    /**
     * 批量调价：前端按「成本 × (1 + 加价率)」算好最终售价后提交。
     * 价格版本不一致（期间有人改过价）时整批拒绝，不部分落库。
     */
    async batchRepriceModels(id, body) {
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
    testModel(id, body, user) {
        return this.protocolTest.test(id, body, user?.id ?? "unknown");
    }
    async setModelEnabled(id, modelId, body) {
        await this.channelModels.setEnabled(id, modelId, body.enabled);
        return { ok: true };
    }
    async setModelSort(id, modelId, body) {
        await this.channelModels.updateSort(id, modelId, body.sortOrder);
        return { ok: true };
    }
};
exports.AdminChannelsController = AdminChannelsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelRead),
    __param(0, (0, common_1.Query)("keyword")),
    __param(1, (0, common_1.Query)("status")),
    __param(2, (0, common_1.Query)("page")),
    __param(3, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("order"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "order", null);
__decorate([
    (0, common_1.Get)("protocols"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelRead),
    __param(0, (0, common_1.Query)("capability")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "protocolCatalog", null);
__decorate([
    (0, common_1.Get)("health"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "healthSnapshot", null);
__decorate([
    (0, common_1.Put)("order"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelWrite),
    (0, admin_decorator_1.AuditAction)("channel.order"),
    (0, admin_decorator_1.AuditTarget)("channel"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChannelOrderBodyDto]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "saveOrder", null);
__decorate([
    (0, common_1.Post)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.channelRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("channel.export"),
    (0, admin_decorator_1.AuditTarget)("channel"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChannelExportBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "export", null);
__decorate([
    (0, common_1.Post)("import"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelWrite),
    (0, admin_decorator_1.AuditAction)("channel.import"),
    (0, admin_decorator_1.AuditTarget)("channel"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChannelImportBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "import", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelWrite),
    (0, admin_decorator_1.AuditAction)("channel.create"),
    (0, admin_decorator_1.AuditTarget)("channel"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChannelWriteBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelWrite),
    (0, admin_decorator_1.AuditAction)("channel.update"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelWriteBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelWrite),
    (0, admin_decorator_1.AuditAction)("channel.delete"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(":id/duplicate"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelWrite),
    (0, admin_decorator_1.AuditAction)("channel.duplicate"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "duplicate", null);
__decorate([
    (0, common_1.Get)(":id/models"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "models", null);
__decorate([
    (0, common_1.Get)(":id/models/order"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "modelOrder", null);
__decorate([
    (0, common_1.Put)(":id/models/order"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.order"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelOrderBodyDto]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "saveModelOrder", null);
__decorate([
    (0, common_1.Post)(":id/models"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.create"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelModelWriteBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "createModel", null);
__decorate([
    (0, common_1.Post)(":id/models/fetch"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelRead),
    (0, admin_decorator_1.AuditAction)("channel_model.fetch"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    (0, rate_limit_guard_1.RateLimit)(RL_CHANNEL_FETCH),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "fetchModels", null);
__decorate([
    (0, common_1.Post)(":id/models/import"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.import"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    (0, rate_limit_guard_1.RateLimit)(RL_CHANNEL_IMPORT),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelModelImportBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "importModels", null);
__decorate([
    (0, common_1.Patch)(":id/models/:modelId"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.update"),
    (0, admin_decorator_1.AuditTarget)("channel_model", "modelId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("modelId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, ChannelModelWriteBodyDto]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "updateModel", null);
__decorate([
    (0, common_1.Delete)(":id/models/:modelId"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.delete"),
    (0, admin_decorator_1.AuditTarget)("channel_model", "modelId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("modelId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "removeModel", null);
__decorate([
    (0, common_1.Post)(":id/models/batch-delete"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.batch_delete"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelBatchDeleteBodyDto]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "batchDeleteModels", null);
__decorate([
    (0, common_1.Post)(":id/models/batch-reprice"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.batch_reprice"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelModelRepriceBodyDto]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "batchRepriceModels", null);
__decorate([
    (0, common_1.Post)(":id/models/test"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelTest),
    (0, admin_decorator_1.AuditAction)("channel_model.test"),
    (0, admin_decorator_1.AuditTarget)("channel", "id"),
    (0, rate_limit_guard_1.RateLimit)(RL_CHANNEL_TEST),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ChannelModelTestBodyDto, Object]),
    __metadata("design:returntype", void 0)
], AdminChannelsController.prototype, "testModel", null);
__decorate([
    (0, common_1.Patch)(":id/models/:modelId/enabled"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.enabled"),
    (0, admin_decorator_1.AuditTarget)("channel_model", "modelId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("modelId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, ChannelEnabledBodyDto]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "setModelEnabled", null);
__decorate([
    (0, common_1.Patch)(":id/models/:modelId/sort"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelWrite),
    (0, admin_decorator_1.AuditAction)("channel_model.sort"),
    (0, admin_decorator_1.AuditTarget)("channel_model", "modelId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("modelId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, ChannelSortBodyDto]),
    __metadata("design:returntype", Promise)
], AdminChannelsController.prototype, "setModelSort", null);
exports.AdminChannelsController = AdminChannelsController = __decorate([
    (0, common_1.Controller)("admin/channels"),
    __metadata("design:paramtypes", [channel_service_1.ChannelService,
        channel_model_service_1.ChannelModelService,
        protocol_test_service_1.ProtocolTestService,
        model_catalog_service_1.ModelCatalogService,
        protocol_catalog_service_1.ProtocolCatalogService,
        channel_health_service_1.ChannelHealthService])
], AdminChannelsController);
/** 全量渠道模型（跨渠道只读视图） */
let AdminChannelModelsController = class AdminChannelModelsController {
    constructor(channelModels, metrics) {
        this.channelModels = channelModels;
        this.metrics = metrics;
    }
    /**
     * 跨渠道模型列表。
     *
     * `includeDisabled=1` 时含已停用的模型（后台「全部模型」视图用 —— 那里
     * 要能看到并重新启用停用项）；默认只给启用的模型（前台模型的线路选择器
     * 用 —— 停用线路进了下拉会让人以为「选了就能用」）。
     */
    async list(channelId, includeDisabled) {
        // 包裹成 { models }：与参考实现契约一致，前端读 .models
        // 必须 await，否则序列化成 `{"models":{}}`。
        return {
            models: await this.channelModels.listAll(channelId ? String(channelId) : undefined, String(includeDisabled ?? "") === "1"),
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
    async health(channelId) {
        return {
            items: await this.metrics.list(channelId ? String(channelId) : undefined),
        };
    }
};
exports.AdminChannelModelsController = AdminChannelModelsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelRead),
    __param(0, (0, common_1.Query)("channelId")),
    __param(1, (0, common_1.Query)("includeDisabled")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminChannelModelsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("health"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelModelRead),
    __param(0, (0, common_1.Query)("channelId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminChannelModelsController.prototype, "health", null);
exports.AdminChannelModelsController = AdminChannelModelsController = __decorate([
    (0, common_1.Controller)("admin/channel-models"),
    __metadata("design:paramtypes", [channel_model_service_1.ChannelModelService,
        channel_model_metrics_service_1.ChannelModelMetricsService])
], AdminChannelModelsController);
//# sourceMappingURL=channel.controller.js.map