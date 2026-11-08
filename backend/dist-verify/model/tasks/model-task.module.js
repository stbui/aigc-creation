"use strict";
/**
 * 任务执行子系统模块（P4-b）。
 *
 * 为什么独立成模块而不是塞进 `ModelModule`：
 *   · `CreditsModule → ModelModule`、`MembershipModule → CreditsModule`，
 *     任务侧既要账单又要积分退款，放进 `ModelModule` 会形成循环依赖；
 *   · 任务执行依赖存储 / AIGC 标识 / 站内消息，这些反过来又依赖模型层，
 *     只有独立模块才能让依赖方向保持单向：
 *     `GenerateModule → ModelTaskModule → {ModelModule, CreditsModule, …}`。
 *
 * 对外只暴露三个门面：
 *   · `TaskAdmissionService` —— 建任务与预留；
 *   · `TaskLifecycleService` —— 后台终止 / 恢复收口；
 *   · `TaskWorkerService` —— 调度入口（`kick` 立即跑一轮）。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelTaskModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const model_module_1 = require("../model.module");
const capabilities_module_1 = require("../../capabilities/capabilities.module");
const credits_module_1 = require("../../credits/credits.module");
const membership_module_1 = require("../../membership/membership.module");
const prompt_tools_module_1 = require("../../prompt-tools/prompt-tools.module");
const notifications_module_1 = require("../../notifications/notifications.module");
const storage_module_1 = require("../../storage/storage.module");
const aigc_label_module_1 = require("../../aigc-label/aigc-label.module");
const channel_slot_service_1 = require("./channel-slot.service");
const task_attempt_service_1 = require("./task-attempt.service");
const task_executor_service_1 = require("./task-executor.service");
const task_media_service_1 = require("./task-media.service");
const task_request_service_1 = require("./task-request.service");
const task_lifecycle_service_1 = require("./task-lifecycle.service");
const task_admission_service_1 = require("./task-admission.service");
const task_worker_service_1 = require("./task-worker.service");
let ModelTaskModule = class ModelTaskModule {
};
exports.ModelTaskModule = ModelTaskModule;
exports.ModelTaskModule = ModelTaskModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            model_module_1.ModelModule,
            // 准入要在扣费之前查后台上下线：`CapabilityAvailabilityService` 由能力模块导出
            capabilities_module_1.CapabilitiesModule,
            credits_module_1.CreditsModule,
            membership_module_1.MembershipModule,
            prompt_tools_module_1.PromptToolsModule,
            notifications_module_1.NotificationsModule,
            storage_module_1.StorageModule,
            aigc_label_module_1.AigcLabelModule,
        ],
        providers: [
            channel_slot_service_1.ChannelSlotService,
            task_attempt_service_1.TaskAttemptService,
            task_executor_service_1.TaskExecutorService,
            task_media_service_1.TaskMediaService,
            task_request_service_1.TaskRequestService,
            task_lifecycle_service_1.TaskLifecycleService,
            task_admission_service_1.TaskAdmissionService,
            task_worker_service_1.TaskWorkerService,
        ],
        // `ChannelSlotService` 供中转复用：代理与任务必须共用同一份渠道并发计数，
        // 各建一份等于把「渠道并发上限」放大一倍
        exports: [task_admission_service_1.TaskAdmissionService, task_lifecycle_service_1.TaskLifecycleService, task_worker_service_1.TaskWorkerService, channel_slot_service_1.ChannelSlotService],
    })
], ModelTaskModule);
//# sourceMappingURL=model-task.module.js.map