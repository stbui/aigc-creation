"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const storage_module_1 = require("../storage/storage.module");
const model_task_module_1 = require("../model/tasks/model-task.module");
const generate_service_1 = require("./generate.service");
const generate_controller_1 = require("./generate.controller");
const tasks_controller_1 = require("./tasks.controller");
/**
 * 生成任务的 HTTP 面。
 *
 * 准入、计费、执行、收尾全部在 `ModelTaskModule` 里；本模块只负责
 * 「把请求转成任务」「把任务转成响应」。`GenerateModule → ModelTaskModule`
 * 单向依赖，`ModelTaskModule` 不知道 HTTP 的存在。
 */
let GenerateModule = class GenerateModule {
};
exports.GenerateModule = GenerateModule;
exports.GenerateModule = GenerateModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, storage_module_1.StorageModule, model_task_module_1.ModelTaskModule],
        controllers: [generate_controller_1.GenerateController, tasks_controller_1.TasksController],
        providers: [generate_service_1.GenerateService],
        // 导出供 AdminModule 的任务重试 / 终止复用（重试与终止的语义收在一处）
        exports: [generate_service_1.GenerateService],
    })
], GenerateModule);
//# sourceMappingURL=generate.module.js.map