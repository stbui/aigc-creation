"use strict";
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
exports.ModelCatalogController = exports.ChannelModelQuoteBodyDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const optional_jwt_auth_guard_1 = require("../../common/optional-jwt-auth.guard");
const model_intent_1 = require("../intent/model-intent");
const user_group_service_1 = require("../user-groups/user-group.service");
const models_controller_1 = require("./models.controller");
const public_model_catalog_service_1 = require("./public-model-catalog.service");
/**
 * 渠道模型报价入参：渠道 + 模型标识 + 意图。
 *
 * ⚠ 意图既接受**平铺**字段（`capability` / `operation` / …，本仓原口径），
 * 也接受**嵌套** `intent` 对象（参考实现 open-ai-canvas 的
 * `{ channelId, modelKey, intent: {...} }`）。两种都归一到同一份意图，
 * 迁移过来的客户端不会被 400 挡下。
 */
class ChannelModelQuoteBodyDto extends models_controller_1.ModelIntentBodyDto {
}
exports.ChannelModelQuoteBodyDto = ChannelModelQuoteBodyDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelQuoteBodyDto.prototype, "channelId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChannelModelQuoteBodyDto.prototype, "modelKey", void 0);
function toIntent(body) {
    const nested = body?.intent;
    return (0, model_intent_1.buildModelRequestIntent)({
        capability: body?.capability ?? nested?.capability,
        operation: body?.operation ?? nested?.operation,
        inputs: body?.inputs ?? nested?.inputs,
        options: body?.options ?? nested?.options,
    });
}
let ModelCatalogController = class ModelCatalogController {
    constructor(catalog, groups) {
        this.catalog = catalog;
        this.groups = groups;
    }
    async list(req) {
        const access = await this.groups.accessForUser(req.user?.id);
        return this.catalog.catalog(access);
    }
    async available(body, req) {
        const access = await this.groups.accessForUser(req.user?.id);
        return this.catalog.catalog(access, toIntent(body));
    }
    async quote(body, req) {
        const access = await this.groups.accessForUser(req.user?.id);
        return {
            quote: await this.catalog.quote(access, body.channelId, body.modelKey, toIntent(body)),
        };
    }
};
exports.ModelCatalogController = ModelCatalogController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ModelCatalogController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('available'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [models_controller_1.ModelIntentBodyDto, Object]),
    __metadata("design:returntype", Promise)
], ModelCatalogController.prototype, "available", null);
__decorate([
    (0, common_1.Post)('quote'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChannelModelQuoteBodyDto, Object]),
    __metadata("design:returntype", Promise)
], ModelCatalogController.prototype, "quote", null);
exports.ModelCatalogController = ModelCatalogController = __decorate([
    (0, common_1.Controller)('model-catalog'),
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    __metadata("design:paramtypes", [public_model_catalog_service_1.PublicModelCatalogService,
        user_group_service_1.UserGroupService])
], ModelCatalogController);
//# sourceMappingURL=model-catalog.controller.js.map