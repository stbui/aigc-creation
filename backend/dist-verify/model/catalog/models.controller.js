"use strict";
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
exports.ModelsController = exports.ModelIntentBodyDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const optional_jwt_auth_guard_1 = require("../../common/optional-jwt-auth.guard");
const model_intent_1 = require("../intent/model-intent");
const user_group_service_1 = require("../user-groups/user-group.service");
const catalog_service_1 = require("./catalog.service");
const quote_service_1 = require("./quote.service");
/** 模型意图入参：能力 + 可选的参考素材数量与模型参数 */
class ModelIntentBodyDto {
}
exports.ModelIntentBodyDto = ModelIntentBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ModelIntentBodyDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ModelIntentBodyDto.prototype, "operation", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ModelIntentBodyDto.prototype, "inputs", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ModelIntentBodyDto.prototype, "options", void 0);
function toIntent(body) {
    return (0, model_intent_1.buildModelRequestIntent)({
        capability: body?.capability,
        operation: body?.operation,
        inputs: body?.inputs,
        options: body?.options,
    });
}
let ModelsController = class ModelsController {
    constructor(catalog, quotes, groups) {
        this.catalog = catalog;
        this.quotes = quotes;
        this.groups = groups;
    }
    /** 全量公开目录；登录用户按会员分组投影 */
    async list(req) {
        const access = await this.groups.accessForUser(req.user?.id);
        return { models: await this.catalog.publicModels(access) };
    }
    /**
     * 按意图筛选：只返回「这组参数现在真的能跑」的模型。
     * 与工作台表单的联动靠这里 —— 不匹配的模型不下发，前端不需要再做猜算。
     */
    async available(body, req) {
        const access = await this.groups.accessForUser(req.user?.id);
        return { models: await this.catalog.publicModels(access, toIntent(body)) };
    }
    /** 报价：返回该模型此组参数的应付积分，`estimated` 表示尚未结算 */
    async quote(id, body, req) {
        const access = await this.groups.accessForUser(req.user?.id);
        return { quote: await this.quotes.quoteLogicalModel(access, id, toIntent(body)) };
    }
};
exports.ModelsController = ModelsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ModelsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('available'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ModelIntentBodyDto, Object]),
    __metadata("design:returntype", Promise)
], ModelsController.prototype, "available", null);
__decorate([
    (0, common_1.Post)(':id/quote'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ModelIntentBodyDto, Object]),
    __metadata("design:returntype", Promise)
], ModelsController.prototype, "quote", null);
exports.ModelsController = ModelsController = __decorate([
    (0, common_1.Controller)('models'),
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    __metadata("design:paramtypes", [catalog_service_1.CatalogService,
        quote_service_1.QuoteService,
        user_group_service_1.UserGroupService])
], ModelsController);
//# sourceMappingURL=models.controller.js.map