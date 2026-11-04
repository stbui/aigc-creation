"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilitiesModule = void 0;
const common_1 = require("@nestjs/common");
const credits_module_1 = require("../credits/credits.module");
const model_module_1 = require("../model/model.module");
const capabilities_controller_1 = require("./capabilities.controller");
const shoppable_carousel_controller_1 = require("./shoppable-carousel.controller");
const capability_availability_service_1 = require("./capability-availability.service");
/**
 * 能力清单模块。
 *
 * 导入 CreditsModule 是为了拿到 CreditPriceService —— 下发时要报**运行时生效价**
 * 而不是 registry 默认值, 否则后台改价对前端展示不生效 (用户看到的价与实扣的价不符)。
 * CreditsModule 不反向依赖本模块, 无循环。
 *
 * 导入 ModelModule 是为了拿到 RouteCatalogService —— `runtime.remoteAvailable`
 * 必须按**路由目录**判定, 与调度器看同一份快照。另查一张表会出现「界面说可用、
 * 提交后 42204」这类反复失败却亮绿灯的按钮。ModelModule 只依赖 PrismaModule,
 * 不反向依赖本模块, 无循环。
 */
let CapabilitiesModule = class CapabilitiesModule {
};
exports.CapabilitiesModule = CapabilitiesModule;
exports.CapabilitiesModule = CapabilitiesModule = __decorate([
    (0, common_1.Module)({
        imports: [credits_module_1.CreditsModule, model_module_1.ModelModule],
        controllers: [capabilities_controller_1.CapabilitiesController, shoppable_carousel_controller_1.ShoppableCarouselController],
        providers: [capability_availability_service_1.CapabilityAvailabilityService],
        exports: [capability_availability_service_1.CapabilityAvailabilityService],
    })
], CapabilitiesModule);
//# sourceMappingURL=capabilities.module.js.map