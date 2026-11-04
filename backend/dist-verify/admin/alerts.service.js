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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAlertsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const admin_role_service_1 = require("./admin-role.service");
const permissions_1 = require("./permissions");
/** 运行中任务超过此值即视为积压，与任务监控页保持同一阈值 */
const RUNNING_ALERT_THRESHOLD = 50;
/** 失败任务近 24 小时达到此值升为 critical */
const FAILED_CRITICAL_THRESHOLD = 10;
/** 工单等待超过此小时数升为 critical */
const TICKET_CRITICAL_HOURS = 24;
/** 备份超过此小时数未成功即告警 */
const BACKUP_STALE_HOURS = 48;
/**
 * 渠道异步退款超过此分钟数仍未落账即告警。
 *
 * 微信 v3 可能在受理后退回 PROCESSING，本仓库没有退款回调端点，订单状态
 * 与积分都不会自动变更。门槛不能太短，否则刚提交、下一分钟就可能完成的
 * 异步退款也会被算成故障。
 */
const REFUND_STUCK_MINUTES = 30;
/** 退款卡单超过此小时数升为 critical */
const REFUND_CRITICAL_HOURS = 24;
const SEVERITY_ORDER = {
    critical: 0,
    warning: 1,
    info: 2,
};
let AdminAlertsService = class AdminAlertsService {
    constructor(prisma, roles) {
        this.prisma = prisma;
        this.roles = roles;
    }
    async list(role) {
        const permissions = await this.roles.getPermissions(role);
        const can = (permission) => permissions.includes(permission);
        const jobs = [];
        if (can(permissions_1.PERMISSIONS.ticketRead))
            jobs.push(this.ticketAlerts());
        if (can(permissions_1.PERMISSIONS.taskRead))
            jobs.push(this.taskAlerts());
        if (can(permissions_1.PERMISSIONS.paymentRead))
            jobs.push(this.reconciliationAlerts());
        if (can(permissions_1.PERMISSIONS.orderRead))
            jobs.push(this.refundAlerts());
        if (can(permissions_1.PERMISSIONS.backupRead))
            jobs.push(this.backupAlerts());
        if (can(permissions_1.PERMISSIONS.invoiceWrite))
            jobs.push(this.invoiceAlerts());
        const items = (await Promise.all(jobs)).flat();
        items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
            (b.count ?? 0) - (a.count ?? 0));
        return {
            generatedAt: new Date().toISOString(),
            /** 待处理告警条目数（不是底层记录总数） */
            total: items.length,
            items,
        };
    }
    async ticketAlerts() {
        /*
         * 只报 `open`：`processing` 表示已有客服受理，属于「正在处理」而不是
         * 「没人回复」。把两者合并计数后再深链到 `?status=open`，会出现角标
         * 写着 12 条、列表只有 7 条的错位。
         */
        const pendingWhere = { status: 'open' };
        const [pending, oldest] = await Promise.all([
            this.prisma.ticket.count({ where: pendingWhere }),
            this.prisma.ticket.findFirst({
                where: pendingWhere,
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
            }),
        ]);
        if (pending === 0)
            return [];
        const hours = oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 3_600_000) : 0;
        const critical = hours >= TICKET_CRITICAL_HOURS;
        return [
            {
                key: 'ticket-pending',
                severity: critical ? 'critical' : 'warning',
                category: 'ticket',
                title: '有待回复工单',
                detail: oldest
                    ? `最早一条已等待 ${formatHours(hours)}，回复会推送站内消息给用户`
                    : '用户提交的问题尚未受理',
                count: pending,
                link: '/admin/tickets?status=open',
            },
        ];
    }
    async taskAlerts() {
        const since = new Date(Date.now() - 24 * 3_600_000);
        const [failed, running] = await Promise.all([
            this.prisma.generationTask.count({
                where: { status: 'failed', createdAt: { gte: since } },
            }),
            this.prisma.generationTask.count({ where: { status: 'running' } }),
        ]);
        const items = [];
        if (failed > 0) {
            items.push({
                key: 'task-failed-24h',
                severity: failed >= FAILED_CRITICAL_THRESHOLD ? 'critical' : 'warning',
                category: 'task',
                title: '近 24 小时有任务失败',
                detail: '失败任务已按规则退款；可到任务监控查看错误码并决定是否重试',
                count: failed,
                link: '/admin/tasks?status=failed',
            });
        }
        if (running > RUNNING_ALERT_THRESHOLD) {
            items.push({
                key: 'task-running-backlog',
                severity: 'warning',
                category: 'task',
                title: '生成任务积压',
                detail: `运行中任务超过 ${RUNNING_ALERT_THRESHOLD} 个，模型通道可能跟不上提交速度`,
                count: running,
                link: '/admin/tasks?status=running',
            });
        }
        return items;
    }
    /**
     * 对账差异告警（2026-11 支付重构）。
     *
     * 数据源从旧 `ReconciliationItem.status='open'` 改为新对账体系的
     * `PaymentReconciliationItem.result NOT IN ('matched','recovered')`：
     * 旧批次表只读保留，新差异全部落在 `PaymentReconciliationRun/Item`。
     */
    async reconciliationAlerts() {
        const open = await this.prisma.paymentReconciliationItem.count({
            where: { result: { notIn: ['matched', 'recovered'] } },
        });
        if (open === 0)
            return [];
        return [
            {
                key: 'reconciliation-open',
                severity: open >= 5 ? 'critical' : 'warning',
                category: 'finance',
                title: '对账差异待处置',
                detail: '差异涉及真实资金，请到支付对账页逐笔核对',
                count: open,
                link: '/admin/payments?tab=reconciliation',
            },
        ];
    }
    async refundAlerts() {
        /*
         * 只报 `processing`：这是「渠道已受理、本地未落账」的中间态。
         *
         * `failed` 不在这里报 —— 退款失败会在后台操作时立即返回 502 并提示重试，
         * 运营当场就知道；而失败的 Refund 行不会因后续重试成功而改写，按它报警
         * 会留下永久噪点。`processing` 则是一笔真实未完成的资金动作：本仓库没有
         * 退款回调端点，必须由运营到商户后台确认，确认前不应从视野里消失。
         */
        const cutoff = new Date(Date.now() - REFUND_STUCK_MINUTES * 60_000);
        const where = { status: 'processing', createdAt: { lt: cutoff } };
        const [stuck, oldest] = await Promise.all([
            this.prisma.refund.count({ where }),
            this.prisma.refund.findFirst({
                where,
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
            }),
        ]);
        if (stuck === 0)
            return [];
        const hours = oldest
            ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 3_600_000)
            : 0;
        return [
            {
                key: 'refund-processing',
                severity: hours >= REFUND_CRITICAL_HOURS ? 'critical' : 'warning',
                category: 'finance',
                title: '退款卡在渠道处理中',
                detail: `渠道已受理但未确认到账，订单状态与积分尚未变更；${stuck} 笔已超过 ${REFUND_STUCK_MINUTES} 分钟，最早一笔等待 ${formatHours(hours)}，需到商户后台核对后人工处理`,
                count: stuck,
                link: '/admin/orders?refundState=processing',
            },
        ];
    }
    async backupAlerts() {
        const [latest, unverified] = await Promise.all([
            this.prisma.backupRecord.findFirst({
                orderBy: { createdAt: 'desc' },
                select: { status: true, createdAt: true, errorMessage: true },
            }),
            this.prisma.backupRecord.count({ where: { status: 'succeeded', verified: false } }),
        ]);
        const items = [];
        if (!latest) {
            items.push({
                key: 'backup-missing',
                severity: 'warning',
                category: 'backup',
                title: '尚无备份记录',
                detail: '生产环境应至少保留一份可恢复的数据库快照',
                count: null,
                link: '/admin/backups',
            });
        }
        else if (latest.status === 'failed') {
            items.push({
                key: 'backup-failed',
                severity: 'critical',
                category: 'backup',
                title: '最近一次备份失败',
                detail: latest.errorMessage?.slice(0, 120) || '备份文件未生成，请检查磁盘空间与数据库路径',
                count: null,
                link: '/admin/backups',
            });
        }
        else {
            const hours = Math.floor((Date.now() - latest.createdAt.getTime()) / 3_600_000);
            if (hours >= BACKUP_STALE_HOURS) {
                items.push({
                    key: 'backup-stale',
                    severity: 'warning',
                    category: 'backup',
                    title: '备份已超过 48 小时',
                    detail: '建议立即执行一次备份，并完成恢复验证',
                    count: null,
                    link: '/admin/backups',
                });
            }
        }
        if (unverified > 0) {
            items.push({
                key: 'backup-unverified',
                severity: 'info',
                category: 'backup',
                title: '有备份尚未通过恢复验证',
                detail: '未验证的备份不能确认可恢复，下载入口也保持禁用',
                count: unverified,
                link: '/admin/backups',
            });
        }
        return items;
    }
    async invoiceAlerts() {
        const pending = await this.prisma.invoice.count({ where: { status: 'pending' } });
        if (pending === 0)
            return [];
        return [
            {
                key: 'invoice-pending',
                severity: 'warning',
                category: 'invoice',
                title: '有待开具发票',
                detail: '用户已提交开票申请，审核后会生成可下载的票据',
                count: pending,
                link: '/admin/invoices',
            },
        ];
    }
};
exports.AdminAlertsService = AdminAlertsService;
exports.AdminAlertsService = AdminAlertsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        admin_role_service_1.AdminRoleService])
], AdminAlertsService);
function formatHours(hours) {
    if (hours < 1)
        return '不足 1 小时';
    if (hours < 24)
        return `${hours} 小时`;
    const days = Math.floor(hours / 24);
    return `${days} 天`;
}
//# sourceMappingURL=alerts.service.js.map