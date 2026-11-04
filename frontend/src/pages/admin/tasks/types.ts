import type { AdminTask } from '../../../types/api';

/** 任务列表与详情共用的一行数据结构。 */
export type AdminTaskRow = AdminTask;

/** 单个与批量操作共用同一组动作语义。 */
export type TaskActionKind = 'retry' | 'cancel' | 'delete';
