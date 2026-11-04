"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketingCoreModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const credits_module_1 = require("../credits/credits.module");
const marketing_service_1 = require("./marketing.service");
/**
 * 营销核心模块 —— 只提供 MarketingService, 不挂任何控制器。
 *
 * **存在的理由是打破依赖环**, 不是为了分层好看:
 *
 *   AdminModule ──> OrdersModule ──> MarketingService
 *        ^                                │
 *        └────────────────────────────────┘
 *
 * 若把 MarketingService 注册在 AdminModule, 上面的环就会形成 (NestJS 下
 * require 时拿到 undefined 的 provider, 表现为运行时 undefined 注入而非编译错误,
 * 是最难查的一类缺陷)。
 *
 * 单独抽出后依赖是单向的:
 *   AdminModule ──> MarketingCoreModule ──> CreditsModule
 *   OrdersModule ──> MarketingCoreModule
 */
let MarketingCoreModule = class MarketingCoreModule {
};
exports.MarketingCoreModule = MarketingCoreModule;
exports.MarketingCoreModule = MarketingCoreModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, credits_module_1.CreditsModule],
        providers: [marketing_service_1.MarketingService],
        exports: [marketing_service_1.MarketingService],
    })
], MarketingCoreModule);
//# sourceMappingURL=marketing-core.module.js.map