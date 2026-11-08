"use strict";
/**
 * 权限点单一事实源。
 *
 * 为什么放这里而不是 admin/ 内: 守卫、装饰器、seed 脚本、前端展示都要用同一份清单,
 * 分散写必然漂移 (与 capability.registry.ts 同理)。
 *
 * 命名格式: `<模块>.<动作>` —— 见 docs/admin-detailed-design.md §0.3。
 * 取值在 SQLite 里以 JSON 数组字符串存AdminRole.permissions。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_STATUS_LABELS = exports.ROLE_LABELS = exports.HIGH_RISK_PERMISSIONS = exports.ROLE_PERMISSIONS = exports.ALL_PERMISSIONS = exports.PERMISSIONS = exports.USER_STATUSES = exports.USER_ROLES = exports.ADMIN_ROLE_CODES = void 0;
exports.isAdminRole = isAdminRole;
exports.isKnownPermission = isKnownPermission;
exports.isHighRisk = isHighRisk;
/** 后台角色 code (对应 User.role) */
exports.ADMIN_ROLE_CODES = ["admin", "operator", "finance"];
/** 全部后台角色 (含 C 端 user) */
exports.USER_ROLES = ["user", ...exports.ADMIN_ROLE_CODES];
/** 账号状态 (对应 User.status) */
exports.USER_STATUSES = ["active", "disabled", "deleted"];
/** 是否后台角色 */
function isAdminRole(role) {
    return exports.ADMIN_ROLE_CODES.includes(role);
}
/**
 * 权限点全集。
 *
 * 一旦有权限点从清单移除, 已存在于 AdminRole.permissions 的旧值会成为"孤儿权限点":
 * 守卫比对不上即等同无权 (兜底默认拒), 因此不会造成越权, 但角色页会显示为
 * 无效项。AdminRoleService 在读取时会过滤掉未登记的权限点; 过滤结果只在
 * 内存生效, 不会自动回写库。
 */
exports.PERMISSIONS = {
    //平台
    platformDashboard: "platform.dashboard",
    // 用户
    userRead: "user.read",
    userWrite: "user.write",
    userDisable: "user.disable",
    userDelete: "user.delete",
    userResetPassword: "user.reset_password",
    // 项目与素材
    projectRead: "project.read",
    projectDelete: "project.delete",
    assetRead: "asset.read",
    assetHide: "asset.hide",
    assetDelete: "asset.delete",
    // 任务
    taskRead: "task.read",
    taskRetry: "task.retry",
    taskCancel: "task.cancel",
    taskDelete: "task.delete",
    // 商品
    productRead: "product.read",
    productWrite: "product.write",
    productPrice: "product.price",
    productPublish: "product.publish",
    // 订单与支付
    orderRead: "order.read",
    orderMarkPaid: "order.mark_paid",
    orderRefund: "order.refund",
    paymentRead: "payment.read",
    /** 渠道配置写入。高危: 保存时写审计，但不要求填写 reason */
    paymentWrite: "payment.write",
    /** 查单/关单。只推进渠道已发生的事实, 不能凭空造钱, 故非高危 */
    paymentOperate: "payment.operate",
    financeDashboard: "finance.dashboard",
    invoiceWrite: "invoice.write",
    /** 渠道对账导入与差异处置。只给财务: 处置会让「账对不上」从看板上消失 */
    financeReconcile: "finance.reconcile",
    // 积分
    creditRead: "credit.read",
    creditAdjust: "credit.adjust",
    // 合规与内容
    complianceRead: "compliance.read",
    complianceGate: "compliance.gate",
    complianceTakedown: "compliance.takedown",
    contentRead: "content.read",
    // 能力与通道
    capabilityRead: "capability.read",
    capabilityWrite: "capability.write",
    /** 存储 / 通知 / 模型渠道的连通性探测：只探测，不写配置 */
    channelTest: "channel.test",
    // 调用记录是只读排障数据, 运营与财务也需要。
    // 旧的 `model.config_read` / `model.config_write` 随 P6 删除 ——
    // 模型配置已由 `channel.*` / `logical_model.*` / `user_group.*` / `plugin.*` 接管。
    modelCallRead: "model.call_read",
    // 渠道与模型（P1 起接管上面三个旧权限点的业务）
    // 凭证、价格档与连通性测试都随渠道模型 / 渠道记录的写权限一起授权：
    // 它们的入口就是同一条 `PATCH`，拆成独立权限点却不在任何路由上校验，
    // 只会让人以为「没授予 secret_write 就改不了凭证」——实际能改。
    channelRead: "channel.read",
    /** 写操作均审计；渠道删除保留业务确认但不要求原因 */
    channelWrite: "channel.write",
    channelModelRead: "channel.model_read",
    channelModelWrite: "channel.model_write",
    logicalModelRead: "logical_model.read",
    logicalModelWrite: "logical_model.write",
    userGroupRead: "user_group.read",
    userGroupWrite: "user_group.write",
    pluginRead: "plugin.read",
    pluginWrite: "plugin.write",
    billingOrderRead: "billing_order.read",
    billingOrderResolve: "billing_order.resolve",
    modelAnalyticsRead: "model.analytics_read",
    // 增长
    marketingWrite: "marketing.write",
    messageWrite: "message.write",
    ticketHandle: "ticket.handle",
    // 合规文本 (B4)。法务正文是用户要举证的文本, 改动必须与内容运营分开授权
    legalRead: "legal.read",
    legalWrite: "legal.write",
    // 工单 (B7 预留; B4 先把权限点落定, 避免角色矩阵二次迁移)
    ticketRead: "ticket.read",
    // 系统
    settingRead: "setting.read",
    settingWrite: "setting.write",
    roleRead: "role.read",
    roleWrite: "role.write",
    auditRead: "audit.read",
    // 数据工具
    dataExport: "data.export",
    dataSearch: "data.search",
    backupRead: "backup.read",
    backupRun: "backup.run",
};
exports.ALL_PERMISSIONS = Object.values(exports.PERMISSIONS);
function isKnownPermission(p) {
    return exports.ALL_PERMISSIONS.includes(p);
}
/**
 * 内置角色的默认权限。
 *
 * 矩阵依据 docs/admin-prd.md §2.2:
 *   财务可改钱、运营可删数据, 两者不可合并 —— 权限合并后无法追责, 审计日志也失去意义。
 * 兜底默认拒: 未列出的权限点一律无权。
 */
exports.ROLE_PERMISSIONS = {
    admin: exports.ALL_PERMISSIONS,
    operator: [
        exports.PERMISSIONS.platformDashboard,
        exports.PERMISSIONS.userRead,
        exports.PERMISSIONS.projectRead,
        exports.PERMISSIONS.projectDelete,
        exports.PERMISSIONS.assetRead,
        exports.PERMISSIONS.assetHide,
        exports.PERMISSIONS.assetDelete,
        exports.PERMISSIONS.taskRead,
        exports.PERMISSIONS.taskRetry,
        exports.PERMISSIONS.taskCancel,
        exports.PERMISSIONS.taskDelete,
        exports.PERMISSIONS.complianceRead,
        exports.PERMISSIONS.contentRead,
        exports.PERMISSIONS.capabilityRead,
        exports.PERMISSIONS.modelCallRead,
        exports.PERMISSIONS.channelRead,
        exports.PERMISSIONS.channelModelRead,
        exports.PERMISSIONS.logicalModelRead,
        exports.PERMISSIONS.userGroupRead,
        exports.PERMISSIONS.pluginRead,
        exports.PERMISSIONS.billingOrderRead,
        exports.PERMISSIONS.modelAnalyticsRead,
        // 只读排障：允许发起连通性测试（只探测，不写配置、不改健康状态）
        exports.PERMISSIONS.channelTest,
        exports.PERMISSIONS.marketingWrite,
        exports.PERMISSIONS.messageWrite,
        exports.PERMISSIONS.ticketRead,
        exports.PERMISSIONS.ticketHandle,
        exports.PERMISSIONS.legalRead,
        exports.PERMISSIONS.auditRead,
        exports.PERMISSIONS.settingRead,
        exports.PERMISSIONS.roleRead,
        exports.PERMISSIONS.dataExport,
        exports.PERMISSIONS.dataSearch,
    ],
    finance: [
        exports.PERMISSIONS.platformDashboard,
        exports.PERMISSIONS.productRead,
        exports.PERMISSIONS.productWrite,
        exports.PERMISSIONS.productPrice,
        exports.PERMISSIONS.productPublish,
        exports.PERMISSIONS.orderRead,
        exports.PERMISSIONS.orderMarkPaid,
        exports.PERMISSIONS.orderRefund,
        exports.PERMISSIONS.paymentRead,
        // 财务可查单/关单(推进渠道事实), 但不能改收款通道配置
        exports.PERMISSIONS.paymentOperate,
        exports.PERMISSIONS.financeDashboard,
        exports.PERMISSIONS.invoiceWrite,
        exports.PERMISSIONS.financeReconcile,
        exports.PERMISSIONS.creditRead,
        exports.PERMISSIONS.creditAdjust,
        // 财务需要对账渠道成本与生成账单，但不配置线路
        exports.PERMISSIONS.channelRead,
        exports.PERMISSIONS.channelModelRead,
        exports.PERMISSIONS.billingOrderRead,
        exports.PERMISSIONS.billingOrderResolve,
        exports.PERMISSIONS.modelAnalyticsRead,
        exports.PERMISSIONS.ticketRead,
        exports.PERMISSIONS.ticketHandle,
        exports.PERMISSIONS.legalRead,
        exports.PERMISSIONS.auditRead,
        exports.PERMISSIONS.roleRead,
        exports.PERMISSIONS.dataExport,
        exports.PERMISSIONS.dataSearch,
    ],
};
/**
 * 高风险权限点，供权限展示与风险分级使用。
 * 是否为请求体要求 `reason` 由各业务 DTO 决定：该列表本身不构成页面门槛，
 * 删除等动作可以只做业务影响确认，审计仍会记录操作人、动作与结果。
 */
exports.HIGH_RISK_PERMISSIONS = [
    exports.PERMISSIONS.userDelete,
    exports.PERMISSIONS.userResetPassword,
    exports.PERMISSIONS.assetDelete,
    exports.PERMISSIONS.projectDelete,
    exports.PERMISSIONS.taskDelete,
    exports.PERMISSIONS.orderRefund,
    exports.PERMISSIONS.creditAdjust,
    exports.PERMISSIONS.complianceTakedown,
    exports.PERMISSIONS.capabilityWrite,
    exports.PERMISSIONS.paymentWrite,
    exports.PERMISSIONS.channelWrite,
    exports.PERMISSIONS.channelModelWrite,
    exports.PERMISSIONS.logicalModelWrite,
    exports.PERMISSIONS.userGroupWrite,
    exports.PERMISSIONS.pluginWrite,
    exports.PERMISSIONS.billingOrderResolve,
    exports.PERMISSIONS.settingWrite,
    exports.PERMISSIONS.legalWrite,
    exports.PERMISSIONS.roleWrite,
    exports.PERMISSIONS.backupRun,
];
function isHighRisk(permission) {
    return exports.HIGH_RISK_PERMISSIONS.includes(permission);
}
/** 角色中文名 */
exports.ROLE_LABELS = {
    user: "用户",
    admin: "管理员",
    operator: "运营",
    finance: "财务",
};
/** 账号状态中文名 */
exports.USER_STATUS_LABELS = {
    active: "正常",
    disabled: "已禁用",
    deleted: "已注销",
};
//# sourceMappingURL=permissions.js.map