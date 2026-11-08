"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketingModule = void 0;
const common_1 = require("@nestjs/common");
const marketing_core_module_1 = require("./marketing-core.module");
const membership_module_1 = require("../membership/membership.module");
const marketing_controller_1 = require("./marketing.controller");
/**
 * C 端营销模块 (M11)。
 *
 * 只放 C 端控制器, 不放 admin 控制器 —— 后者留在 AdminModule 内,
 * 与其守卫/拦截器 (AdminGuard / PermissionGuard / AuditInterceptor) 同处。
 * 把 admin 端点放这里会导致权限校验链断裂, 是安全缺陷而非风格问题。
 *
 * MarketingService 由 MarketingCoreModule 提供 (该模块存在的唯一理由是
 * 打破 AdminModule ↔ OrdersModule 的循环依赖, 详见其文件注释)。
 */
let MarketingModule = class MarketingModule {
};
exports.MarketingModule = MarketingModule;
exports.MarketingModule = MarketingModule = __decorate([
    (0, common_1.Module)({
        imports: [marketing_core_module_1.MarketingCoreModule, membership_module_1.MembershipModule],
        controllers: [marketing_controller_1.MarketingPublicController, marketing_controller_1.MarketingMeController],
    })
], MarketingModule);
//# sourceMappingURL=marketing.module.js.map