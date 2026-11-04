"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const credits_module_1 = require("../credits/credits.module");
const membership_controller_1 = require("./membership.controller");
const membership_service_1 = require("./membership.service");
/**
 * 会员模块。
 *
 * MembershipService 被订单(折扣)、生成(并发校验/快速通道)、
 * 调度器(月度积分) 共用, 因此导出。
 */
let MembershipModule = class MembershipModule {
};
exports.MembershipModule = MembershipModule;
exports.MembershipModule = MembershipModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, credits_module_1.CreditsModule],
        controllers: [membership_controller_1.MembershipController],
        providers: [membership_service_1.MembershipService],
        exports: [membership_service_1.MembershipService],
    })
], MembershipModule);
//# sourceMappingURL=membership.module.js.map