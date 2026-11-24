/**
 * 测试用的内置角色权限集。
 *
 * 字面量复刻 `backend/src/admin/permissions.ts` 的 `ROLE_PERMISSIONS`（admin /
 * operator / finance），避免前端测试 import 后端包。后端角色矩阵调整时同步改这里
 * —— 判定逻辑本身不依赖具体权限点，只有这层数据会漂移。
 *
 * 2026-11-24 基线：admin = 全部 70 点；operator 37 点；finance 27 点
 * （T-054 已从 finance 撤掉 `product.price`，与 origin/main 一致）。
 *
 * `financeLegacy` 另行给出「旧授权还没清干净」的过渡态：生产库的角色权限持久化在
 * `AdminRole.permissions`，代码默认值只对 seed 生效，财务角色在角色页保存前可能仍
 * 带着 `product.price`。它不是当前角色矩阵，只用于验证「即使旧授权还留着，T-043
 * 收紧 nav 之后入口也已经关掉」。
 */

/** 后端 `ALL_PERMISSIONS` 的全量快照，admin 角色即全量 */
const ALL: string[] = [
  'platform.dashboard',
  'user.read',
  'user.write',
  'user.disable',
  'user.delete',
  'user.reset_password',
  'project.read',
  'project.write',
  'project.delete',
  'asset.read',
  'asset.hide',
  'asset.delete',
  'task.read',
  'task.retry',
  'task.cancel',
  'task.delete',
  'product.read',
  'product.write',
  'product.price',
  'product.publish',
  'product.delete',
  'order.read',
  'order.mark_paid',
  'order.refund',
  'order.delete',
  'payment.read',
  'payment.write',
  'payment.operate',
  'finance.dashboard',
  'finance.reconcile',
  'invoice.write',
  'credit.read',
  'credit.adjust',
  'compliance.read',
  'compliance.gate',
  'compliance.takedown',
  'content.read',
  'template.read',
  'template.write',
  'prompt.read',
  'prompt.write',
  'capability.read',
  'capability.write',
  'channel.test',
  'model.call_read',
  'channel.read',
  'channel.write',
  'channel.model_read',
  'channel.model_write',
  'logical_model.read',
  'logical_model.write',
  'user_group.read',
  'user_group.write',
  'plugin.read',
  'plugin.write',
  'billing_order.read',
  'billing_order.resolve',
  'model.analytics_read',
  'marketing.read',
  'marketing.write',
  'message.write',
  'ticket.read',
  'ticket.handle',
  'setting.read',
  'setting.write',
  'role.read',
  'role.write',
  'data.export',
  'data.search',
  'backup.read',
  'backup.run',
];

const operator: string[] = [
  'platform.dashboard',
  'user.read',
  'project.read',
  'project.write',
  'project.delete',
  'asset.read',
  'asset.hide',
  'asset.delete',
  'task.read',
  'task.retry',
  'task.cancel',
  'task.delete',
  'compliance.read',
  'content.read',
  'template.read',
  'template.write',
  'prompt.read',
  'prompt.write',
  'capability.read',
  'model.call_read',
  'channel.read',
  'channel.model_read',
  'logical_model.read',
  'user_group.read',
  'plugin.read',
  'billing_order.read',
  'model.analytics_read',
  'channel.test',
  'marketing.read',
  'marketing.write',
  'message.write',
  'ticket.read',
  'ticket.handle',
  'setting.read',
  'role.read',
  'data.export',
  'data.search',
];

const finance: string[] = [
  'platform.dashboard',
  'product.read',
  'product.write',
  'product.publish',
  'product.delete',
  'order.read',
  'order.mark_paid',
  'order.refund',
  'order.delete',
  'payment.read',
  'payment.operate',
  'finance.dashboard',
  'invoice.write',
  'finance.reconcile',
  'credit.read',
  'credit.adjust',
  'channel.read',
  'channel.model_read',
  'billing_order.read',
  'billing_order.resolve',
  'model.analytics_read',
  'marketing.read',
  'ticket.read',
  'ticket.handle',
  'role.read',
  'data.export',
  'data.search',
];

/**
 * 过渡态：finance 在角色页保存前可能仍留着 T-054 之前授予的 `product.price`。
 * 生产库角色权限是持久化数据，代码默认值只对 seed 生效，不能假定已同步。
 */
const financeLegacy: string[] = [...finance, 'product.price'];

export const ROLE_PERMISSIONS_FOR_TEST = { admin: ALL, operator, finance, financeLegacy } as const;
