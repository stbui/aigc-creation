import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { JobType, Queue } from 'bullmq';
import { GENERATION_QUEUE, type GenerationJobData } from './task-queue.constants';

/** BullMQ 里仍会继续执行的作业状态；已结束/失败的不算“已排期”。 */
const SCHEDULED_STATES: JobType[] = [
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
];
/** 一次取 1000 个作业 ID，避免把整条队列的 Job 对象全读进内存。 */
const JOB_ID_PAGE_SIZE = 1000;

/**
 * 单次队列命令的硬截止。
 *
 * BullMQ 要求连接 `maxRetriesPerRequest: null`（见 `config/redis-connection.ts`），
 * 而 ioredis 的 `enableOfflineQueue` 默认 true：Redis 不可达时命令**只进离线队列，
 * 既不 reject 也不 resolve**。于是 `await queue.add(...)` / `getRanges(...)` 会永久
 * 挂起，`catch` 永远进不去 —— 调用方的错误处理形同虚设。
 *
 * Worker 的阻塞连接必须保留这两个默认（BullMQ 靠长轮询取作业），所以不能改连接选项，
 * 只能在**生产者侧**给每次调用一个截止。5 秒：远大于正常 Redis 往返，又远小于
 * 调度器 10 分钟的节拍，一轮最多拖 5 秒而不是把 `running` 永久卡住。
 *
 * ⚠ 超时只放弃「等待」，原生命令仍留在 ioredis 离线队列里，Redis 恢复后会照常执行
 * —— 对入队这正是我们想要的（作业不该丢）；对读取则下一轮会重新读一次。
 */
const QUEUE_COMMAND_TIMEOUT_MS = 5_000;

/**
 * 生成任务的队列生产者。
 *
 * 只负责把 taskId 投进 BullMQ；任务状态机、计费与切线仍在
 * `TaskWorkerService`。生产者与消费者分开，提交请求只做入队，不在 HTTP
 * 请求里执行任何上游调用。
 */
@Injectable()
export class TaskQueueService {
  private readonly log = new Logger(TaskQueueService.name);

  /**
   * 最近一次「读不到队列」的原因；成功读取后清空。
   *
   * 只存一条消息，不维护时间序列 —— 目的单一：让恢复对账能把队列停摆报成
   * 一次失败（后台按连续失败告警），而不是静默返回 0。
   */
  lastReadFailure: string | null = null;

  constructor(@InjectQueue(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>) {}

  /**
   * 给一次队列命令加截止，超时按错误抛出。
   *
   * 定时器 `unref`，不让它拖住进程退出与测试后的事件循环。
   */
  private async bounded<T>(action: string, run: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`${action} 超过 ${QUEUE_COMMAND_TIMEOUT_MS}ms 未返回（Redis 不可达？）`),
              ),
            QUEUE_COMMAND_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 同一个 taskId 只保留一个作业：BullMQ 的 jobId 去重覆盖 waiting /
   * delayed / active，重复提交不会把同一任务跑两遍。
   *
   * Redis 不可达时在 {@link QUEUE_COMMAND_TIMEOUT_MS} 内抛错，而不是把调用方
   * （`TaskWorkerService.kick` / 恢复对账）挂在离线队列上。
   */
  async enqueue(taskId: string, delayMs = 0): Promise<void> {
    try {
      await this.bounded('任务入队', () =>
        this.queue.add(
          'execute',
          { taskId },
          {
            jobId: taskId,
            delay: delayMs > 0 ? delayMs : undefined,
            // 业务异常在 processJob 内已转成任务终态；这里只兜住 DB / Redis
            // 短暂不可用。重试会重新读取任务状态，fencing token 保证不会重复派发。
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
      );
    } catch (error) {
      this.log.error(`任务 ${taskId} 入队失败: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 返回队列中仍会继续执行的 taskId 集合。
   *
   * 恢复对账用它做一次批量读取，而不是对每张任务各查一次 job：Redis
   * 不可达（含命令超时）时返回 null，调用方本轮跳过，避免把“查不到”误判成
   * “没作业”后对整库任务发起补投。
   *
   * ⚠ 返回值只区分「读到了」与「没读到」；**为什么没读到**记在
   * {@link lastReadFailure}，供恢复对账把它当成一次失败上报，而不是当成
   * 「本轮无事可做」的成功。
   */
  async scheduledTaskIds(): Promise<Set<string> | null> {
    const ids = new Set<string>();
    try {
      for (let start = 0; ; start += JOB_ID_PAGE_SIZE) {
        const page = await this.bounded('读取队列作业列表', () =>
          this.queue.getRanges(SCHEDULED_STATES, start, start + JOB_ID_PAGE_SIZE - 1),
        );
        if (page.length === 0) break;
        for (const id of page) ids.add(id);
        if (page.length < JOB_ID_PAGE_SIZE) break;
      }
    } catch (error) {
      this.lastReadFailure = (error as Error).message;
      this.log.warn(`读取队列作业列表失败: ${this.lastReadFailure}`);
      return null;
    }
    this.lastReadFailure = null;
    return ids;
  }
}
