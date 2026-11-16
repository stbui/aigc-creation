/**
 * 任务监控的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/api`、`types/model`、`types/task-route`）在此统一
 * re-export，业务文件一律从 `./types` 取；本目录派生的行 / 动作语义也定义于此。
 */

/* `AdminTaskRow` 的别名基底需要本地可见，故此处额外 import 一次（与下方 re-export 不冲突）。 */
import type { AdminTask } from '../../../types/api';

/* 外部类型统一转出 */
export type {
  AdminTask,
  AdminTaskCongestion,
  AdminTaskDetail,
  AdminTaskListResult,
  BatchSummary,
} from '../../../types/api';

export type {
  ApiLogListResult,
  ApiLogView,
  BillingOrderListResult,
  BillingOrderView,
} from '../../../types/model';

export type { AdminTaskRouteAttempt } from '../../../types/task-route';

/** 任务列表与详情共用的一行数据结构。 */
export type AdminTaskRow = AdminTask;

/** 单个与批量操作共用同一组动作语义。 */
export type TaskActionKind = 'retry' | 'cancel' | 'delete';
