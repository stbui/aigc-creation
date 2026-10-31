/**
 * 权限点单一事实源。
 *
 * 为什么放这里而不是 admin/ 内: 守卫、装饰器、seed 脚本、前端展示都要用同一份清单,
 * 分散写必然漂移 (与 capability.registry.ts 同理)。
 *
 * 命名格式: `<模块>.<动作>` —— 见 docs/admin-detailed-design.md §0.3。
 * 取值在 SQLite 里以 JSON 数组字符串存AdminRole.permissions。
 */

/** 后台角色 code (对应 User.role) */
export const ADMIN_ROLE_CODES = ['admin', 'operator', 'finance'] as const;
export type AdminRoleCode = (typeof ADMIN_ROLE_CODES)[number];

/** 全部后台角色 (含 C 端 user) */
export const USER_ROLES = ['user', ...ADMIN_ROLE_CODES] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 账号状态 (对应 User.status) */
export const USER_STATUSES = ['active', 'disabled', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** 是否后台角色 */
export function isAdminRole(role: string): role is AdminRoleCode {
  return (ADMIN_ROLE_CODES as readonly string[]).includes(role);
}

/**
 * 权限点全集。
 *
 * 一旦有权限点从清单移除, 已存在于 AdminRole.permissions 的旧值会成为"孤儿权限点":
 * 守卫比对不上即等同无权 (兜底默认拒), 因此不会造成越权, 但角色页会显示为
 * 无效项。AdminRoleService 在读取时会过滤掉未登记的权限点并回写。
 */
export const PERMISSIONS = {
  //平台
  platformDashboard: 'platform.dashboard',

  // 用户
  userRead: 'user.read',
  userWrite: 'user.write',
  userDisable: 'user.disable',
  userDelete: 'user.delete',
  userResetPassword: 'user.reset_password',

  // 项目与素材
  projectRead: 'project.read',
  projectDelete: 'project.delete',
  assetRead: 'asset.read',
  assetHide: 'asset.hide',
  assetDelete: 'asset.delete',

  // 任务
  taskRead: 'task.read',
  taskRetry: 'task.retry',
  taskCancel: 'task.cancel',

  // 商品
  productRead: 'product.read',
  productWrite: 'product.write',
  productPrice: 'product.price',
  productPublish: 'product.publish',

  // 订单与支付
  orderRead: 'order.read',
  orderMarkPaid: 'order.mark_paid',
  orderRefund: 'order.refund',
  paymentRead: 'payment.read',
  financeDashboard: 'finance.dashboard',
  invoiceWrite: 'invoice.write',
  /** 渠道对账导入与差异处置。只给财务: 处置会让「账对不上」从看板上消失 */
  financeReconcile: 'finance.reconcile',

  // 积分
  creditRead: 'credit.read',
  creditAdjust: 'credit.adjust',

  // 合规与内容
  complianceRead: 'compliance.read',
  complianceGate: 'compliance.gate',
  complianceTakedown: 'compliance.takedown',
  contentRead: 'content.read',

  // 能力与通道
  capabilityRead: 'capability.read',
  capabilityWrite: 'capability.write',
  /** 存储 / 通知的连通性探测：只探测，不写配置 */
  channelTest: 'channel.test',

  // 调用记录是只读排障数据, 运营与财务也需要。
  // 旧的 `model.config_read` / `model.config_write` 随 P6 删除 ——
  // 模型配置已由 `channel.*` / `logical_model.*` / `user_group.*` / `plugin.*` 接管。
  modelCallRead: 'model.call_read',

  // 渠道与模型（P1 起接管上面三个旧权限点的业务）
  // 凭证、价格档与连通性测试都随渠道模型 / 渠道记录的写权限一起授权：
  // 它们的入口就是同一条 `PATCH`，拆成独立权限点却不在任何路由上校验，
  // 只会让人以为「没授予 secret_write 就改不了凭证」——实际能改。
  channelRead: 'channel.read',
  channelWrite: 'channel.write',
  channelModelRead: 'channel.model_read',
  channelModelWrite: 'channel.model_write',
  logicalModelRead: 'logical_model.read',
  logicalModelWrite: 'logical_model.write',
  userGroupRead: 'user_group.read',
  userGroupWrite: 'user_group.write',
  pluginRead: 'plugin.read',
  pluginWrite: 'plugin.write',
  billingOrderRead: 'billing_order.read',
  billingOrderResolve: 'billing_order.resolve',
  modelAnalyticsRead: 'model.analytics_read',

  // 增长
  marketingWrite: 'marketing.write',
  messageWrite: 'message.write',
  ticketHandle: 'ticket.handle',

  // 合规文本 (B4)。法务正文是用户要举证的文本, 改动必须与内容运营分开授权
  legalRead: 'legal.read',
  legalWrite: 'legal.write',

  // 工单 (B7 预留; B4 先把权限点落定, 避免角色矩阵二次迁移)
  ticketRead: 'ticket.read',

  // 系统
  settingRead: 'setting.read',
  settingWrite: 'setting.write',
  roleWrite: 'role.write',
  auditRead: 'audit.read',

  // 数据工具
  dataExport: 'data.export',
  dataImport: 'data.import',
  dataBatch: 'data.batch',
  dataSearch: 'data.search',
  backupRead: 'backup.read',
  backupRun: 'backup.run',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export function isKnownPermission(p: string): p is Permission {
  return (ALL_PERMISSIONS as string[]).includes(p);
}

/**
 * 内置角色的默认权限。
 *
 * 矩阵依据 docs/admin-prd.md §2.2:
 *   财务可改钱、运营可删数据, 两者不可合并 —— 权限合并后无法追责, 审计日志也失去意义。
 * 兜底默认拒: 未列出的权限点一律无权。
 */
export const ROLE_PERMISSIONS: Record<AdminRoleCode, Permission[]> = {
  admin: ALL_PERMISSIONS,

  operator: [
    PERMISSIONS.platformDashboard,
    PERMISSIONS.userRead,
    PERMISSIONS.projectRead,
    PERMISSIONS.projectDelete,
    PERMISSIONS.assetRead,
    PERMISSIONS.assetHide,
    PERMISSIONS.assetDelete,
    PERMISSIONS.taskRead,
    PERMISSIONS.taskRetry,
    PERMISSIONS.taskCancel,
    PERMISSIONS.complianceRead,
    PERMISSIONS.contentRead,
    PERMISSIONS.capabilityRead,
    PERMISSIONS.modelCallRead,
    PERMISSIONS.channelRead,
    PERMISSIONS.channelModelRead,
    PERMISSIONS.logicalModelRead,
    PERMISSIONS.userGroupRead,
    PERMISSIONS.pluginRead,
    PERMISSIONS.billingOrderRead,
    PERMISSIONS.modelAnalyticsRead,
    // 只读排障：允许发起连通性测试（只探测，不写配置、不改健康状态）
    PERMISSIONS.channelTest,
    PERMISSIONS.marketingWrite,
    PERMISSIONS.messageWrite,
    PERMISSIONS.ticketRead,
    PERMISSIONS.ticketHandle,
    PERMISSIONS.legalRead,
    PERMISSIONS.auditRead,
    PERMISSIONS.settingRead,
    PERMISSIONS.dataExport,
    PERMISSIONS.dataSearch,
  ],

  finance: [
    PERMISSIONS.platformDashboard,
    PERMISSIONS.productRead,
    PERMISSIONS.productWrite,
    PERMISSIONS.productPrice,
    PERMISSIONS.productPublish,
    PERMISSIONS.orderRead,
    PERMISSIONS.orderMarkPaid,
    PERMISSIONS.orderRefund,
    PERMISSIONS.paymentRead,
    PERMISSIONS.financeDashboard,
    PERMISSIONS.invoiceWrite,
    PERMISSIONS.financeReconcile,
    PERMISSIONS.creditRead,
    PERMISSIONS.creditAdjust,
    // 财务需要对账渠道成本与生成账单，但不配置线路
    PERMISSIONS.channelRead,
    PERMISSIONS.channelModelRead,
    PERMISSIONS.billingOrderRead,
    PERMISSIONS.billingOrderResolve,
    PERMISSIONS.modelAnalyticsRead,
    PERMISSIONS.ticketRead,
    PERMISSIONS.ticketHandle,
    PERMISSIONS.legalRead,
    PERMISSIONS.auditRead,
    PERMISSIONS.dataExport,
    PERMISSIONS.dataSearch,
  ],
};

/**
 * 需填写「操作原因」的高危权限点。
 * 这些动作会写 AdminAuditLog.reason, 前端强制输入确认词。
 */
export const HIGH_RISK_PERMISSIONS: Permission[] = [
  PERMISSIONS.userDelete,
  PERMISSIONS.userResetPassword,
  PERMISSIONS.assetDelete,
  PERMISSIONS.projectDelete,
  PERMISSIONS.orderRefund,
  PERMISSIONS.creditAdjust,
  PERMISSIONS.complianceTakedown,
  PERMISSIONS.capabilityWrite,
  PERMISSIONS.channelWrite,
  PERMISSIONS.channelModelWrite,
  PERMISSIONS.logicalModelWrite,
  PERMISSIONS.userGroupWrite,
  PERMISSIONS.pluginWrite,
  PERMISSIONS.billingOrderResolve,
  PERMISSIONS.settingWrite,
  PERMISSIONS.legalWrite,
  PERMISSIONS.roleWrite,
  PERMISSIONS.backupRun,
];

export function isHighRisk(permission: string): boolean {
  return (HIGH_RISK_PERMISSIONS as string[]).includes(permission);
}

/** 角色中文名 */
export const ROLE_LABELS: Record<string, string> = {
  user: '用户',
  admin: '管理员',
  operator: '运营',
  finance: '财务',
};

/** 账号状态中文名 */
export const USER_STATUS_LABELS: Record<string, string> = {
  active: '正常',
  disabled: '已禁用',
  deleted: '已注销',
};