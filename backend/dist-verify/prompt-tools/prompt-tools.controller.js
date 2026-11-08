"use strict";
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
exports.PromptToolsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const prompt_tools_service_1 = require("./prompt-tools.service");
const polish_prompt_dto_1 = require("./dto/polish-prompt.dto");
const image_to_prompt_dto_1 = require("./dto/image-to-prompt.dto");
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
 * 没有可用文本线路 / 上游全部失败 → `50201` + 面向用户的通用文案, **不回落**。
 * 上游失败的具体原因（基址没配 / 令牌无效 / 超时）只写进程日志与调用记录，
 * 不返回给前台用户。
 */
let PromptToolsController = class PromptToolsController {
    constructor(service) {
        this.service = service;
    }
    /** AI 润色 */
    async polish(user, dto) {
        return this.service.polish(dto.text, dto.textOnly ?? false, user.id);
    }
    /** 图片转提示词 */
    async imageToPrompt(user, dto) {
        return this.service.imageToPrompt(user.id, dto.assetId, dto.extra);
    }
};
exports.PromptToolsController = PromptToolsController;
__decorate([
    (0, common_1.Post)('polish'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, polish_prompt_dto_1.PolishPromptDto]),
    __metadata("design:returntype", Promise)
], PromptToolsController.prototype, "polish", null);
__decorate([
    (0, common_1.Post)('image-to-prompt'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, image_to_prompt_dto_1.ImageToPromptDto]),
    __metadata("design:returntype", Promise)
], PromptToolsController.prototype, "imageToPrompt", null);
exports.PromptToolsController = PromptToolsController = __decorate([
    (0, common_1.Controller)('prompt-tools'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [prompt_tools_service_1.PromptToolsService])
], PromptToolsController);
//# sourceMappingURL=prompt-tools.controller.js.map