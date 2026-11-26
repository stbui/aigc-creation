/**
 * 系统信息页的展示映射。
 *
 * 页面只渲染业务文案：环境、平台、架构、存储后端、任务状态与调用类型都先在这里
 * 换成中文，不把 `production` / `darwin` / `succeeded` / `create` 这类枚举值
 * 直接摆到值班人员面前。任务状态的用词取自 `STATUS_META`，与告警页、任务页
 * 保持同一套术语；后端新增取值时这里补一行，缺项回退原始值而不是隐藏。
 */

import { STATUS_META } from './components';

/** 启动档位（`NODE_ENV` 的三种取值）。 */
export const ENV_LABELS: Record<string, string> = {
  development: '开发',
  test: '测试',
  production: '生产',
};

/** `process.platform` 的常见取值；未登记的保持原值。 */
export const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** `process.arch` 的常见取值；未登记的保持原值。 */
export const ARCH_LABELS: Record<string, string> = {
  x64: 'x86-64',
  arm64: 'ARM64',
  ia32: 'x86',
};

/** 存储后端：与素材管理、存储配置页同一套叫法。 */
export const STORAGE_BACKEND_LABELS: Record<string, string> = {
  local: '本地磁盘',
  oss: '阿里云 OSS',
  minio: 'MinIO',
};

/** 上游调用类型：与调用记录页、任务详情页同词。 */
export const REQUEST_KIND_LABELS: Record<string, string> = {
  create: '创建',
  poll: '轮询',
  task: '连通性测试',
  proxy: '中转',
};

/** 生成任务的五种状态；文案与色调统一来自 `STATUS_META`。 */
export const TASK_STATUS_LABELS: Record<string, string> = {
  queued: STATUS_META.queued.label,
  running: STATUS_META.running.label,
  succeeded: STATUS_META.succeeded.label,
  failed: STATUS_META.failed.label,
  cancelled: STATUS_META.cancelled.label,
};
