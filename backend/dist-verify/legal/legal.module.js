"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegalModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const legal_controller_1 = require("./legal.controller");
const legal_service_1 = require("./legal.service");
/**
 * 法务域。
 *
 * `LegalService` 导出给三处用：公开 controller、后台版本管理、
 * 以及注册/下单写 `ConsentRecord` 时的版本解析。
 */
let LegalModule = class LegalModule {
};
exports.LegalModule = LegalModule;
exports.LegalModule = LegalModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [legal_controller_1.LegalController],
        providers: [legal_service_1.LegalService],
        exports: [legal_service_1.LegalService],
    })
], LegalModule);
//# sourceMappingURL=legal.module.js.map