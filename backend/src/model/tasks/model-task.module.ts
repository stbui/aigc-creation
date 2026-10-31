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

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ModelModule } from '../model.module';
import { CapabilitiesModule } from '../../capabilities/capabilities.module';
import { CreditsModule } from '../../credits/credits.module';
import { MembershipModule } from '../../membership/membership.module';
import { PromptToolsModule } from '../../prompt-tools/prompt-tools.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { StorageModule } from '../../storage/storage.module';
import { AigcLabelModule } from '../../aigc-label/aigc-label.module';
import { ChannelSlotService } from './channel-slot.service';
import { TaskAttemptService } from './task-attempt.service';
import { TaskExecutorService } from './task-executor.service';
import { TaskMediaService } from './task-media.service';
import { TaskRequestService } from './task-request.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskAdmissionService } from './task-admission.service';
import { TaskWorkerService } from './task-worker.service';

@Module({
  imports: [
    PrismaModule,
    ModelModule,
    // 准入要在扣费之前查后台上下线：`CapabilityAvailabilityService` 由能力模块导出
    CapabilitiesModule,
    CreditsModule,
    MembershipModule,
    PromptToolsModule,
    NotificationsModule,
    StorageModule,
    AigcLabelModule,
  ],
  providers: [
    ChannelSlotService,
    TaskAttemptService,
    TaskExecutorService,
    TaskMediaService,
    TaskRequestService,
    TaskLifecycleService,
    TaskAdmissionService,
    TaskWorkerService,
  ],
  // `ChannelSlotService` 供中转复用：代理与任务必须共用同一份渠道并发计数，
  // 各建一份等于把「渠道并发上限」放大一倍
  exports: [TaskAdmissionService, TaskLifecycleService, TaskWorkerService, ChannelSlotService],
})
export class ModelTaskModule {}
