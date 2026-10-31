import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ModelTaskModule } from '../model/tasks/model-task.module';
import { GenerateService } from './generate.service';
import { GenerateController } from './generate.controller';
import { TasksController } from './tasks.controller';

/**
 * 生成任务的 HTTP 面。
 *
 * 准入、计费、执行、收尾全部在 `ModelTaskModule` 里；本模块只负责
 * 「把请求转成任务」「把任务转成响应」。`GenerateModule → ModelTaskModule`
 * 单向依赖，`ModelTaskModule` 不知道 HTTP 的存在。
 */
@Module({
  imports: [PrismaModule, StorageModule, ModelTaskModule],
  controllers: [GenerateController, TasksController],
  providers: [GenerateService],
  // 导出供 AdminModule 的任务重试 / 终止复用（重试与终止的语义收在一处）
  exports: [GenerateService],
})
export class GenerateModule {}
