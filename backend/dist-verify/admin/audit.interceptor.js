"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuditInterceptor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditInterceptor = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const rxjs_1 = require("rxjs");
const prisma_service_1 = require("../prisma/prisma.service");
const admin_decorator_1 = require("./admin.decorator");
/** 写操作方法 —— 只有这些方法会被审计 */
const AUDITED_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
/** 请求体中需要写入 detail 的字段 (其余字段不记录, 避免把凭据写进审计) */
const DETAIL_FIELDS = [
    "status",
    "role",
    "name",
    "email",
    "sku",
    "priceCents",
    "credits",
    "creditsValidDays",
    "grantPlan",
    "enabled",
    "mode",
    "capability",
    "modality",
    "protocol",
    "model",
    "modelId",
    "priority",
    "sortOrder",
    "dir",
    "amount",
    "type",
];
/** 绝不写进审计 detail 的字段名片段 (大小写不敏感) */
const SENSITIVE_PATTERNS = [
    "password",
    "token",
    "secret",
    "hash",
    "credential",
];
/** 管理端动作的稳定中文审计原因。未列出的动作使用 action 原值兜底。 */
const AUDIT_REASON_LABELS = {
    "data.export": "导出后台数据",
    "data.cleanup": "清理过期后台数据",
    "setting.update": "更新系统设置",
    "role.permissions_update": "更新角色权限",
    "user.batch": "批量变更用户账号",
    "user.status_change": "变更用户账号状态",
    "user.role_change": "变更用户角色",
    "user.password_reset": "重置用户登录密码",
    "user.delete": "删除用户账号",
    "task.batch": "批量变更任务",
    "task.delete": "删除任务及其产出",
    "task.retry": "重试任务",
    "task.cancel": "终止任务",
    "backup.run": "手动执行数据备份",
    "backup.prune": "清理历史数据备份",
    "backup.delete": "删除数据备份",
    "asset.status_change": "变更素材状态",
    "asset.batch_status": "批量变更素材状态",
    "asset.batch": "批量处理素材",
    "asset.delete": "删除素材",
    "project.delete": "删除项目",
    "aigc.label_update": "更新 AI 标识样式",
    "legal.upsert": "保存法务文档版本",
    "legal.publish": "发布法务文档版本",
    "membership-plan.create": "创建会员套餐",
    "membership-plan.update": "更新会员套餐",
    "membership-plan.status": "变更会员套餐状态",
    "invoice.issue": "开具发票",
    "invoice.reject": "驳回发票",
    "order.mark_paid": "标记订单已支付",
    "order.batch": "批量处理订单",
    "order.refund": "订单退款",
    "credit.adjust": "人工调整用户积分",
    "credit.batch_adjust": "批量调整用户积分",
    "credit.import": "导入用户积分",
    "credit.price_update": "更新积分价格",
    "credit.price_reset": "重置积分价格",
    "product.create": "创建商品",
    "product.update": "更新商品",
    "product.status_change": "变更商品状态",
    "payment.provider_config_save": "保存支付渠道配置",
    "payment.settings_save": "保存支付设置",
    "payment.product_create": "创建支付商品",
    "payment.product_update": "更新支付商品",
    "payment.order_query": "查询支付订单状态",
    "payment.order_close": "关闭支付订单",
    "payment.reconciliation_run": "执行支付对账",
    "payment.reconciliation_import": "导入支付对账单",
    "retention.cleanup": "执行数据保留清理",
    "capability.toggle": "变更能力上下线状态",
    "channel.create": "创建渠道",
    "channel.update": "更新渠道",
    "channel.delete": "删除渠道",
    "channel.duplicate": "复制渠道",
    "channel.export": "导出渠道",
    "channel.import": "导入渠道",
    "channel.order": "调整渠道排序",
    "channel_model.create": "创建渠道模型",
    "channel_model.update": "更新渠道模型",
    "channel_model.delete": "删除渠道模型",
    "channel_model.batch_delete": "批量删除渠道模型",
    "channel_model.batch_reprice": "批量调整渠道模型价格",
    "channel_model.fetch": "拉取渠道模型目录",
    "channel_model.import": "导入渠道模型",
    "channel_model.enabled": "变更渠道模型启停状态",
    "channel_model.order": "调整渠道模型排序",
    "channel_model.sort": "调整渠道模型排序",
    "channel_model.test": "测试渠道模型",
    "logical_model.create": "创建前台模型",
    "logical_model.update": "更新前台模型",
    "logical_model.archive": "归档前台模型",
    "user_group.create": "创建用户分组",
    "user_group.update": "更新用户分组",
    "user_group.delete": "删除用户分组",
    "plugin.toggle": "变更插件启停状态",
    "plugin.install": "安装插件",
    "plugin.uninstall": "卸载插件",
    "provider_catalog.refresh": "刷新服务商目录",
    "provider_catalog.install": "安装服务商插件",
    "billing_order.resolve": "人工核对账单",
    "billing_order.batch_resolve": "批量人工核对账单",
    "ticket.update": "更新工单",
    "ticket.reply": "回复工单",
    "notification.broadcast": "发送站内通知",
    "notification.template": "更新通知模板",
    "scheduler.run": "手动执行定时任务",
    "storage.probe": "检测存储配置",
    "storage.switch": "切换存储配置",
    "coupon.create": "创建优惠券",
    "coupon.update": "更新优惠券",
    "coupon.toggle": "变更优惠券状态",
    "campaign.create": "创建限时活动",
    "campaign.update": "更新限时活动",
    "campaign.toggle": "变更限时活动状态",
    "invite.rule_update": "更新邀请规则",
    "invite.reward_grant": "发放邀请奖励",
    "checkin.rule_update": "更新签到规则",
};
/**
 * 操作审计拦截器。
 *
 * 记录所有后台写操作 (POST/PATCH/PUT/DELETE), 以及**显式声明了
 * `@AuditAction` 的读操作** (导出 / 备份下载) —— 后者同样是把数据带出系统。
 *
 * 关键取舍: **审计失败不阻断业务**。
 * 审计表写失败时只打WARN 日志 —— 若让业务随审计失败, 审计系统就成了单点故障,
 * 用户操作会被日志问题拖垮, 反而降低了可追溯性。
 */
let AuditInterceptor = AuditInterceptor_1 = class AuditInterceptor {
    constructor(prisma, reflector) {
        this.prisma = prisma;
        this.reflector = reflector;
        this.logger = new common_1.Logger(AuditInterceptor_1.name);
    }
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        // 全局拦截器: 只审计后台动作, C 端流量不受影响
        const url = request.originalUrl ?? request.url ?? "";
        if (!url.split("?")[0].includes("/admin"))
            return next.handle();
        const method = request.method ?? "GET";
        const adminUser = request.adminUser;
        // 显式声明优先; 未声明时回退到 URL 推断, 保证审计条目不丢失
        const declaredAction = this.reflector.get(admin_decorator_1.AUDIT_ACTION_KEY, context.getHandler());
        const declaredTarget = this.reflector.get(admin_decorator_1.AUDIT_TARGET_KEY, context.getHandler());
        /*
         * 写操作一律审计; **导出 / 下载这类 GET 只要显式声明了动作也要审计**。
         *
         * 2026-10-29 修: 此前只按方法白名单放行, 所有 `@Get('export')` 上的
         * `@AuditAction('data.export')` 实际从未落库 —— 代码与文档都写着
         * 「导出即把用户数据带出系统, 留审计」, 但审计表里查不到任何导出记录。
         * 显式声明了动作就说明该端点需要留痕, 与 HTTP 方法无关。
         */
        if (!AUDITED_METHODS.has(method) && !declaredAction)
            return next.handle();
        return next.handle().pipe((0, rxjs_1.tap)({
            next: () => {
                void this.write(request, method, adminUser, declaredAction, declaredTarget, true, null);
            },
            error: (err) => {
                void this.write(request, method, adminUser, declaredAction, declaredTarget, false, err);
            },
        }));
    }
    async write(request, method, adminUser, declaredAction, declaredTarget, success, err) {
        try {
            const { action, targetType, targetId } = this.resolveTarget(request.url, declaredAction, declaredTarget, request.params);
            await this.prisma.adminAuditLog.create({
                data: {
                    actorId: adminUser?.id ?? "unknown",
                    actorRole: adminUser?.role ?? "unknown",
                    action,
                    targetType,
                    targetId,
                    detail: JSON.stringify(this.buildDetail(request, success, err)),
                    reason: this.automaticReason(action, request.body),
                    ip: request.ip ?? "unknown",
                    success,
                },
            });
        }
        catch (e) {
            this.logger.warn(`审计写入失败 (不阻断业务): ${method} ${request.url} — ${e.message}`);
        }
    }
    /**
     * 解析 action / targetType / targetId。
     *
     * action: 优先用 @AuditAction 声明值; 未声明时从 URL 推断。
     * target: 优先用 @AuditTarget 声明的对象类型与路由参数; 未声明时从 URL 推断。
     * 其余字段: 格式 /admin/<resource>/<id?>[/<sub?>]
     *   例: /admin/users/u_123/disable → resource='users', targetId='u_123'
     * 解析失败时回退为原始路径, 审计条目不会因解析失败而丢失。
     */
    resolveTarget(url, declaredAction, declaredTarget, params) {
        const path = url.split("?")[0].replace(/\/+$/, "");
        const parts = path.split("/").filter(Boolean); // ['api','v1','admin', ...]
        const idx = parts.indexOf("admin");
        const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
        const resource = rest[0] ?? "unknown";
        // `export` / `download` 是动作而不是对象 id, 不能写进 targetId
        const fallbackTargetId = rest[1] && rest[1] !== "export" && rest[1] !== "download" ? rest[1] : "-";
        const declaredTargetId = declaredTarget
            ? String(params?.[declaredTarget.param] ?? "").trim()
            : "";
        const action = declaredAction ?? resource;
        return {
            action,
            targetType: declaredTarget?.targetType ?? resource,
            targetId: declaredTargetId || fallbackTargetId,
        };
    }
    /** 只保留白名单字段, 过滤敏感字段 */
    buildDetail(request, success, err) {
        const source = request.body ?? {};
        const detail = {
            ok: success,
            ...(request.auditExtra ?? {}),
        };
        for (const field of DETAIL_FIELDS) {
            // 双保险: 白名单已限定字段, 这里再挡一次敏感词, 防止后续往 DETAIL_FIELDS
            // 追加字段时误把凭据类内容写进审计 (审计本身对所有后台角色可读)
            if (SENSITIVE_PATTERNS.some((p) => field.toLowerCase().includes(p)))
                continue;
            if (field in source)
                detail[field] = source[field];
        }
        if (!success && err instanceof Error) {
            detail.error = err.message.slice(0, 200);
        }
        return detail;
    }
    /** 根据动作及少量状态参数生成可读审计原因；不信任请求体里的自由文本。 */
    automaticReason(action, body) {
        const status = typeof body?.["status"] === "string" ? body["status"] : "";
        const batchAction = typeof body?.["action"] === "string" ? body["action"] : "";
        if (action === "user.status_change") {
            return status === "disabled" ? "禁用用户账号" : "启用用户账号";
        }
        if (action === "user.batch") {
            return batchAction === "disable"
                ? "批量禁用用户账号"
                : "批量启用用户账号";
        }
        if (action === "task.batch") {
            if (batchAction === "delete")
                return "批量删除任务及其产出";
            if (batchAction === "retry")
                return "批量重试任务";
            return "批量终止任务";
        }
        if (action === "asset.status_change") {
            return status === "hidden" ? "下架素材" : "恢复素材";
        }
        if (action === "asset.batch_status") {
            return status === "hidden" ? "批量下架素材" : "批量恢复素材";
        }
        if (action === "asset.batch") {
            if (batchAction === "delete")
                return "批量删除素材";
            return batchAction === "hide" ? "批量下架素材" : "批量恢复素材";
        }
        if (action === "order.batch")
            return "批量核销订单";
        return AUDIT_REASON_LABELS[action] ?? `后台操作：${action}`;
    }
};
exports.AuditInterceptor = AuditInterceptor;
exports.AuditInterceptor = AuditInterceptor = AuditInterceptor_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        core_1.Reflector])
], AuditInterceptor);
//# sourceMappingURL=audit.interceptor.js.map