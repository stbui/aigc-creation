"use strict";
/**
 * 后台前台模型接口（`/api/v1/admin/logical-models`）。
 *
 * 移植自 open-ai-canvas `handler/logical_models.go` 的管理端部分：
 *   · `GET    /admin/logical-models`           列表（含归档开关）
 *   · `POST   /admin/logical-models`           新建
 *   · `PATCH  /admin/logical-models/:id`       保存（新 revision + 线路重建）
 *   · `DELETE /admin/logical-models/:id`       归档
 *   · `POST   /admin/logical-models/:id/simulate` 路由模拟（只读）
 *
 * 语义校验在 `LogicalModelAdminService`；这里只做形状校验与权限 / 审计声明。
 * `PATCH` 按**全量提交**处理（与参考实现一致）—— 前端表单始终提交完整对象，
 * 缺省字段会按默认值落库，不要用它做「只改一个字段」的局部更新。
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
exports.AdminLogicalModelsController = exports.LogicalModelWriteBodyDto = exports.LogicalRouteBodyDto = exports.SimulateBodyDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("../../admin/admin.decorator");
const permissions_1 = require("../../admin/permissions");
const capability_config_1 = require("../domain/capability-config");
const json_1 = require("../domain/json");
const model_intent_1 = require("../intent/model-intent");
const router_service_1 = require("../routing/router.service");
const user_group_service_1 = require("../user-groups/user-group.service");
const models_controller_1 = require("./models.controller");
const logical_model_admin_service_1 = require("./logical-model.admin.service");
class SimulateBodyDto extends models_controller_1.ModelIntentBodyDto {
}
exports.SimulateBodyDto = SimulateBodyDto;
/** 线路入参：嵌套对象整体透传，语义校验在 service */
class LogicalRouteBodyDto {
}
exports.LogicalRouteBodyDto = LogicalRouteBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalRouteBodyDto.prototype, "channelModelId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], LogicalRouteBodyDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(999_999),
    __metadata("design:type", Number)
], LogicalRouteBodyDto.prototype, "priority", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100_000),
    __metadata("design:type", Number)
], LogicalRouteBodyDto.prototype, "weight", void 0);
/** 前台模型保存入参 */
class LogicalModelWriteBodyDto {
}
exports.LogicalModelWriteBodyDto = LogicalModelWriteBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "icon", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], LogicalModelWriteBodyDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(999_999),
    __metadata("design:type", Number)
], LogicalModelWriteBodyDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "pricePolicy", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "billingMode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], LogicalModelWriteBodyDto.prototype, "unitPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], LogicalModelWriteBodyDto.prototype, "inputPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], LogicalModelWriteBodyDto.prototype, "outputPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], LogicalModelWriteBodyDto.prototype, "cachedPriceMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], LogicalModelWriteBodyDto.prototype, "legacyModelIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], LogicalModelWriteBodyDto.prototype, "capabilitySpec", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], LogicalModelWriteBodyDto.prototype, "defaultOptions", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Array)
], LogicalModelWriteBodyDto.prototype, "routes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogicalModelWriteBodyDto.prototype, "sourceChannelModelId", void 0);
let AdminLogicalModelsController = class AdminLogicalModelsController {
    constructor(models, router, groups) {
        this.models = models;
        this.router = router;
        this.groups = groups;
    }
    list(includeArchived) {
        return this.models.list(String(includeArchived ?? "") === "1" ||
            String(includeArchived ?? "") === "true");
    }
    get(id) {
        return this.models.get(id);
    }
    create(body, user) {
        return this.models.save("", body, user?.id ?? "");
    }
    /**
     * 静态段 `:id/simulate` 与 `:id` 分属不同 HTTP 方法，不冲突。
     *
     * ## 意图的 capability 以模型自己的能力合同为准
     *
     * 命名空间有两层，混用会直接被拒：
     *   · `LogicalModel.capability` 是**产品能力 id**（`expand` / `main_image` / …）；
     *   · 能力合同里的 `capability` 是**模态**（`image` / `video` / `text`）。
     *
     * `buildModelRequestIntent` 只认模态（它要与 `spec.capability` 比对），
     * 而页面很容易把产品能力 id 传上来 —— 直接透传会得到
     * 「请求缺少有效的模型能力类型」。
     *
     * 所以这里**以模型自己的合同为准**：读出产品合同的模态后再建意图。
     * 入参的 `capability` 只在它本身是合法模态时才算数（显式模拟别的模态），
     * 传了产品 id 就当没传 —— 模型的模态是权威源，客户端不该改。
     */
    async simulate(id, body) {
        const access = await this.groups.systemAccess();
        const model = await this.router.findModel(id);
        if (!model)
            throw (0, json_1.badRequest)("所选模型不可用");
        const requested = (0, capability_config_1.normalizeCapability)(body?.capability);
        const intent = (0, model_intent_1.buildModelRequestIntent)({
            capability: requested || model.productSpec.capability,
            operation: body?.operation,
            inputs: body?.inputs,
            options: body?.options,
        });
        return this.router.simulate(access, id, intent);
    }
    update(id, body, user) {
        return this.models.save(id, body, user?.id ?? "");
    }
    async archive(id) {
        await this.models.archive(id);
        return { ok: true };
    }
};
exports.AdminLogicalModelsController = AdminLogicalModelsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.logicalModelRead),
    __param(0, (0, common_1.Query)("includeArchived")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminLogicalModelsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.logicalModelRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminLogicalModelsController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.logicalModelWrite),
    (0, admin_decorator_1.AuditAction)("logical_model.create"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [LogicalModelWriteBodyDto, Object]),
    __metadata("design:returntype", void 0)
], AdminLogicalModelsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)(":id/simulate"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.logicalModelRead),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, SimulateBodyDto]),
    __metadata("design:returntype", Promise)
], AdminLogicalModelsController.prototype, "simulate", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.logicalModelWrite),
    (0, admin_decorator_1.AuditAction)("logical_model.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, LogicalModelWriteBodyDto, Object]),
    __metadata("design:returntype", void 0)
], AdminLogicalModelsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.logicalModelWrite),
    (0, admin_decorator_1.AuditAction)("logical_model.archive"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminLogicalModelsController.prototype, "archive", null);
exports.AdminLogicalModelsController = AdminLogicalModelsController = __decorate([
    (0, common_1.Controller)("admin/logical-models"),
    __metadata("design:paramtypes", [logical_model_admin_service_1.LogicalModelAdminService,
        router_service_1.RouterService,
        user_group_service_1.UserGroupService])
], AdminLogicalModelsController);
//# sourceMappingURL=admin-logical-model.controller.js.map