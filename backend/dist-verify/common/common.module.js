"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommonModule = void 0;
const common_1 = require("@nestjs/common");
const signed_url_service_1 = require("./signed-url.service");
const settings_service_1 = require("./settings.service");
/**
 * 横切关注点模块（B5）。
 *
 * `@Global()`：素材、任务、统计、后台素材都要给自己的 URL 加签名，
 * 逐个 imports 只会制造样板，且容易出现某个模块漏导入 → 那一路返回的
 * `signedUrl` 恒为 null，表现为「列表里一部分图 403、一部分正常」。
 *
 * 限流守卫**不在这里**：它作为 APP_GUARD 在 AppModule 注册（全局守卫按
 * 元数据触发，没标注 @RateLimit 的路由完全不受影响）。
 */
let CommonModule = class CommonModule {
};
exports.CommonModule = CommonModule;
exports.CommonModule = CommonModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [signed_url_service_1.SignedUrlService, settings_service_1.SettingsService],
        exports: [signed_url_service_1.SignedUrlService, settings_service_1.SettingsService],
    })
], CommonModule);
//# sourceMappingURL=common.module.js.map