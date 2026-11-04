"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AigcLabelModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const aigc_label_service_1 = require("./aigc-label.service");
const aigc_label_controller_1 = require("./aigc-label.controller");
/**
 * AIGC 可见标识配置（2026-10-21）。
 *
 * 不设 @Global：只有生成链路（GenerateModule）与后台页面用它，
 * 全局模块会让「谁依赖了标识配置」变得不可见。
 */
let AigcLabelModule = class AigcLabelModule {
};
exports.AigcLabelModule = AigcLabelModule;
exports.AigcLabelModule = AigcLabelModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [aigc_label_controller_1.AigcLabelController, aigc_label_controller_1.AdminAigcLabelController],
        providers: [aigc_label_service_1.AigcLabelService],
        exports: [aigc_label_service_1.AigcLabelService],
    })
], AigcLabelModule);
//# sourceMappingURL=aigc-label.module.js.map