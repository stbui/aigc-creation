/**
 * AdminAuditPage 的本地常量与类型。
 */

import type { AdminAuditListResult } from '../../../types/api';

export type Row = AdminAuditListResult['items'][number];

/**
 * 动作码 → 中文文案。
 *
 * 覆盖三部分：当前 `@AuditAction` 声明的全部动作、早期版本遗留的动作码
 * （`model.channel_*` 等）、以及少见的批量动作。**不认识的码不在这里编造文案**
 * —— 页面把它按原码等宽展示，方便直接认出「还有个动作没登记」。
 */
export const ACTION_LABELS: Record<string, string> = {
  // 账号与权限
  'user.status_change': '禁用/启用账号',
  'user.role_change': '变更用户角色',
  'user.password_reset': '重置用户密码',
  'user.delete': '删除用户',
  'user.merge_accounts': '合并账号',
  'user.batch': '批量处理用户',
  'role.permissions_update': '调整角色权限',
  'user_group.create': '新增用户分组',
  'user_group.update': '修改用户分组',
  'user_group.delete': '删除用户分组',
  // 系统
  'setting.update': '修改系统设置',
  'data.export': '导出数据',
  'data.cleanup': '清理数据',
  'scheduler.run': '执行定时任务',
  'backup.download': '下载备份',
  'backup.run': '手动备份',
  'backup.verify': '验证备份',
  'backup.delete': '删除备份',
  'backup.prune': '清理过期备份',
  'storage.probe': '探测存储',
  'aigc.label_update': '修改 AI 标识',
  'notification.broadcast': '发送站内广播',
  'legal.upsert': '保存法务文档',
  'legal.publish': '发布法务文档',
  // 素材与项目
  'asset.status_change': '变更素材状态',
  'asset.batch_status': '批量变更素材状态',
  'asset.batch': '批量处理素材',
  'asset.delete': '删除素材',
  'project.delete': '删除项目',
  // 能力、积分与会员
  'capability.toggle': '启停能力',
  'credit.adjust': '调整积分',
  'credit.batch_adjust': '批量调整积分',
  'credit.import': '导入积分',
  'credit.price_update': '修改能力价格',
  'credit.price_reset': '恢复能力价格',
  'membership-plan.create': '新建会员套餐',
  'membership-plan.update': '修改会员套餐',
  'membership-plan.status': '上下架会员套餐',
  // 渠道与模型
  'channel.create': '新增渠道',
  'channel.update': '修改渠道',
  'channel.delete': '删除渠道',
  'channel.duplicate': '复制渠道',
  'channel.order': '调整渠道顺序',
  'channel.export': '导出渠道配置',
  'channel.import': '导入渠道配置',
  'channel_model.create': '新增渠道模型',
  'channel_model.update': '修改渠道模型',
  'channel_model.delete': '删除渠道模型',
  'channel_model.batch_delete': '批量删除渠道模型',
  'channel_model.batch_reprice': '批量调整渠道模型价格',
  'channel_model.order': '调整渠道模型顺序',
  'channel_model.sort': '调整渠道模型排序',
  'channel_model.enabled': '启停渠道模型',
  'channel_model.fetch': '拉取上游模型清单',
  'channel_model.import': '导入上游模型',
  'channel_model.test': '渠道模型连通性测试',
  'logical_model.create': '新增前台模型',
  'logical_model.update': '修改前台模型',
  'logical_model.archive': '归档前台模型',
  'plugin.toggle': '启停插件',
  'plugin.verify': '校验插件',
  'plugin.install': '安装插件',
  'plugin.uninstall': '卸载插件',
  'provider_catalog.refresh': '刷新服务商目录',
  'provider_catalog.install': '安装服务商插件',
  // 交易与营销
  'product.create': '新增商品',
  'product.update': '修改商品',
  'product.status_change': '上下架商品',
  'product.delete': '删除商品',
  'order.batch': '批量处理订单',
  'order.mark_paid': '标记订单已支付',
  'order.refund': '订单退款',
  'order.refund_confirm': '确认订单退款',
  'payment.order_close': '关闭支付订单',
  'payment.order_query': '查询支付订单',
  'payment.product_create': '新增支付商品',
  'payment.product_update': '修改支付商品',
  'payment.provider_config_save': '保存支付渠道配置',
  'payment.settings_save': '保存支付设置',
  'payment.reconciliation_run': '执行支付对账',
  'payment.reconciliation_import': '导入对账文件',
  'payment.exception_claim': '认领支付异常',
  'payment.exception_close': '关闭支付异常',
  'payment.exception_retry_refund': '重试退款（支付异常）',
  'billing_order.resolve': '处置生成账单',
  'billing_order.batch_resolve': '批量处置生成账单',
  'invoice.issue': '开具发票',
  'invoice.reject': '驳回发票',
  'invoice.red_flush': '红冲发票',
  'coupon.create': '新建优惠券',
  'coupon.update': '修改优惠券',
  'coupon.toggle': '启停优惠券',
  'campaign.create': '新建限时活动',
  'campaign.update': '修改限时活动',
  'campaign.toggle': '启停限时活动',
  'checkin.rule_update': '修改签到规则',
  'invite.rule_update': '修改邀请规则',
  'invite.reward_grant': '发放邀请奖励',
  // 任务与工单
  'task.batch': '批量处理任务',
  'task.retry': '重试任务',
  'task.cancel': '终止任务',
  'task.delete': '删除任务',
  'ticket.reply': '回复工单',
  'ticket.update': '更新工单',
  // 早期版本遗留的动作码（历史记录仍会命中）
  'model.channel_create': '新增渠道',
  'model.channel_update': '修改渠道',
  'model.channel_delete': '删除渠道',
  'model.channel_move': '调整渠道顺序',
  'model.channel_models': '修改渠道模型',
  'model.channel_test': '测试渠道连通性',
  'model.channel_materialize': '生成前台模型',
  'model.config_update': '修改模型配置',
};

/** 动作码 → 展示文案；未登记时原样返回，页面用等宽字体标出这是原始码。 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * 对象类型 → 中文文案。
 *
 * 后端 `targetType` 多数由 URL 资源名推导（`users` / `channel_model` …），
 * 直接展示等于把内部表名漏给运营。未登记的类型回退原值。
 */
export const TARGET_TYPE_LABELS: Record<string, string> = {
  users: '用户',
  roles: '角色',
  'user-groups': '用户分组',
  assets: '素材',
  projects: '项目',
  tasks: '任务',
  channels: '渠道',
  channel: '渠道',
  'model-channels': '渠道',
  channel_model: '渠道模型',
  'logical-models': '前台模型',
  'model-config': '模型配置',
  'model-calls': '调用记录',
  'api-logs': '调用记录',
  capabilities: '能力',
  'credit-prices': '能力价格',
  credits: '积分',
  products: '商品',
  orders: '订单',
  payments: '支付',
  'billing-orders': '生成账单',
  invoices: '发票',
  coupons: '优惠券',
  campaigns: '限时活动',
  'membership-plans': '会员套餐',
  tickets: '工单',
  settings: '系统设置',
  storage: '存储',
  backups: '备份',
  'audit-logs': '审计日志',
  'aigc-label': 'AI 标识',
  notifications: '站内消息',
  scheduler: '定时任务',
  checkin: '签到',
  invites: '邀请',
  legal: '法务文档',
  plugins: '插件',
};

/** 对象类型 → 展示文案；未登记时原样返回。 */
export function targetTypeLabel(targetType: string): string {
  return TARGET_TYPE_LABELS[targetType] ?? targetType;
}
