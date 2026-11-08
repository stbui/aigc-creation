"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptToolsModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const storage_module_1 = require("../storage/storage.module");
const model_module_1 = require("../model/model.module");
const prompt_tools_service_1 = require("./prompt-tools.service");
const prompt_tools_controller_1 = require("./prompt-tools.controller");
/**
 * 提示词工具模块 —— AI 润色 / 图片转提示词。
 *
 * 依赖: Prisma (读素材) + Storage (读素材字节) + Model (text 能力选路与协议调用)。
 * ModelModule 只依赖 Prisma, 不反向依赖本模块, 无循环。
 */
let PromptToolsModule = class PromptToolsModule {
};
exports.PromptToolsModule = PromptToolsModule;
exports.PromptToolsModule = PromptToolsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, storage_module_1.StorageModule, model_module_1.ModelModule],
        controllers: [prompt_tools_controller_1.PromptToolsController],
        providers: [prompt_tools_service_1.PromptToolsService],
        exports: [prompt_tools_service_1.PromptToolsService],
    })
], PromptToolsModule);
//# sourceMappingURL=prompt-tools.module.js.map