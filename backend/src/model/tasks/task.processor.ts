import { Processor, WorkerHost } from '@nestjs/bullmq';
import { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DelayedError, type Job } from 'bullmq';
import type { AppConfigValues } from '../../config/env.validation';
import { GENERATION_QUEUE, type GenerationJobData } from './task-queue.constants';
import { TaskWorkerService } from './task-worker.service';

/** `@Processor` 需要一个静态值；实际并发在 onApplicationBootstrap 用配置覆盖。 */
const DEFAULT_WORKER_CONCURRENCY = 64;

/**
 * 官方 BullMQ Worker 适配层。
 *
 * 业务执行全部交给 `TaskWorkerService.processJob`；本类只负责把“稍后再查”
 * 翻译成 BullMQ 的 delayed job，让同一个作业继续存活，而不是新起一套定时器。
 */
@Processor(GENERATION_QUEUE, { concurrency: DEFAULT_WORKER_CONCURRENCY })
export class TaskProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly tasks: TaskWorkerService,
    private readonly config: ConfigService<AppConfigValues, true>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    const configured = this.config.get<number>('model.activeTaskLimit');
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      this.worker.concurrency = Math.trunc(configured);
    }
  }

  async process(job: Job<GenerationJobData>, token?: string): Promise<void> {
    const outcome = await this.tasks.processJob(job.data.taskId);
    if (outcome.action === 'delay') {
      // BullMQ 的 moveToDelayed 不接受 0ms；到期时间相同也应至少留 1ms。
      await job.moveToDelayed(Date.now() + Math.max(1, outcome.delayMs), token);
      throw new DelayedError();
    }
  }
}
