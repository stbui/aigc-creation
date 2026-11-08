"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const account_controller_1 = require("./account.controller");
const account_lifecycle_service_1 = require("./account-lifecycle.service");
const account_service_1 = require("./account.service");
/**
 * 账户自助（资料 / 改密 / 导出 / 注销）。
 *
 * `AccountLifecycleService` 导出：后台用户管理复用同一份注销实现，
 * 避免两条链路各删各的子表。
 */
let AccountModule = class AccountModule {
};
exports.AccountModule = AccountModule;
exports.AccountModule = AccountModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [account_controller_1.AccountController],
        providers: [account_service_1.AccountService, account_lifecycle_service_1.AccountLifecycleService],
        exports: [account_service_1.AccountService, account_lifecycle_service_1.AccountLifecycleService],
    })
], AccountModule);
//# sourceMappingURL=account.module.js.map