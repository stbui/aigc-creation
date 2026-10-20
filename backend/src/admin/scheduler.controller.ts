import { Controller, Get, Post, Query } from '@nestjs/common';
import { AuditAction, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { SchedulerService } from './scheduler.service';
import { PERMISSIONS } from './permissions';

/** 允许手动触发的任务 —— 只开放幂等且低风险的,备份/清理不在此列 */
const MANUALLY_RUNNABLE = ['order-expire', 'credit-expire', 'membership'];

/**
 * 调度器可观测 (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 为什么需要它: 一个静默失败三周的定时任务比不设更危险 ——
 * 所有人都会以为它在跑。必须让人能随时看到"每个任务上次跑没跑、跑成功没有、
 * 连续失败几次", 连续失败 > 0 时立刻能发现。
 */
@Controller('admin/scheduler')
export class AdminSchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  /** 各任务最近执行状态 */
  @Get('status')
  @RequirePermission(PERMISSIONS.settingRead)
  status() {
    return {
      tasks: this.scheduler.taskStatus(),
      manuallyRunnable: MANUALLY_RUNNABLE,
      // 哪些任务当前有连续失败 —— 前端可据此置顶告警
      failing: this.scheduler
        .taskStatus()
        .filter((t) => t.consecutiveFailures > 0)
        .map((t) => t.name),
    };
  }

  /**
   * 手动触发任务。
   *
   * ⚠ **只开放幂等任务**: 超时订单关闭与积分回收都是"扫一批已到期的",
   * 重复执行不会产生副作用。而备份/清理会写文件或删数据, 不适合被随意手动触发。
   */
  @Post('run')
  @RequirePermission(PERMISSIONS.settingWrite)
  @AuditAction('scheduler.run')
  run(@Query('task') task: string) {
    if (!MANUALLY_RUNNABLE.includes(task)) {
      throw new AppError(
        40001,
        `不支持手动触发: ${task} (可触发: ${MANUALLY_RUNNABLE.join(', ')})`,
        400,
      );
    }
    return this.scheduler.runNow(task);
  }
}
