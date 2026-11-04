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
exports.LegalController = void 0;
const common_1 = require("@nestjs/common");
const legal_service_1 = require("./legal.service");
/**
 * 法务文档（公开，免登录）。
 *
 * 未登录用户也必须能读隐私政策 —— 注册页的协议链接对游客可见，
 * 挂 JwtAuthGuard 会让"同意前先看看条款"变成不可能。
 */
let LegalController = class LegalController {
    constructor(legal) {
        this.legal = legal;
    }
    /** 四类文档的当前版本概览 */
    async index() {
        return this.legal.index();
    }
    /** 取某文档的最新已发布版本；一条都没发布时 `data` 为 null（前端有内置兜底） */
    async current(slug) {
        return this.legal.current(slug);
    }
};
exports.LegalController = LegalController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], LegalController.prototype, "index", null);
__decorate([
    (0, common_1.Get)(':slug'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], LegalController.prototype, "current", null);
exports.LegalController = LegalController = __decorate([
    (0, common_1.Controller)('legal'),
    __metadata("design:paramtypes", [legal_service_1.LegalService])
], LegalController);
//# sourceMappingURL=legal.controller.js.map