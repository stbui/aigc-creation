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
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
exports.renderTemplate = renderTemplate;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
/** 内置兜底文案。key = type */
const FALLBACK = {
    payment_success: { title: '支付成功', body: '订单 {orderNo} 已支付，积分已到账。', link: '/orders' },
    credit_granted: { title: '积分到账', body: '本次获得 {credits} 积分。', link: '/credits' },
    task_failed: {
        title: '生成失败，积分已退回',
        body: '任务「{capability}」执行失败，{credits} 积分已原额退回。',
        link: '/works',
    },
    membership_expired: { title: '会员已到期', body: '你的会员已于 {date} 到期。', link: '/packages' },
    ticket_reply: { title: '工单有新回复', body: '工单 {ticketNo} 已由客服回复。', link: '/tickets' },
    broadcast: { title: '平台公告', body: '', link: '/' },
};
/** 把 `{name}` 替换成 vars 里的值；未提供的占位符原样保留（便于发现漏传） */
function renderTemplate(text, vars = {}) {
    return text.replace(/\{(\w+)\}/g, (m, key) => {
        const v = vars[key];
        return v === undefined || v === null ? m : String(v);
    });
}
let NotificationsService = NotificationsService_1 = class NotificationsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(NotificationsService_1.name);
    }
    /**
     * 写一条站内消息。
     *
     * **永不抛异常**。调用点遍布支付回调、任务执行、调度任务，
     * 任何一处因为它失败而回滚，都比"少一条通知"严重得多。
     */
    async notify(input) {
        try {
            const code = input.templateCode ?? input.type;
            const tpl = await this.prisma.messageTemplate.findFirst({
                where: { code, channel: 'inapp', enabled: true },
            });
            const vars = input.vars ?? {};
            const fallback = FALLBACK[input.type];
            const title = renderTemplate(tpl?.subject || input.fallbackTitle || fallback?.title || '通知', vars);
            const rawBody = tpl?.body || input.fallbackBody || fallback?.body || '';
            const body = renderTemplate(rawBody, vars);
            await this.prisma.notification.create({
                data: {
                    userId: input.userId,
                    type: input.type,
                    title: title.slice(0, 120),
                    body: body ? body.slice(0, 2000) : null,
                    link: input.link ?? fallback?.link ?? null,
                },
            });
        }
        catch (e) {
            this.logger.warn(`站内通知写入失败 (${input.type} → ${input.userId}): ${e.message}`);
        }
    }
    /** C 端：我的消息（默认最近 30 条，可按未读过滤） */
    async list(userId, opts = {}) {
        const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
        const rows = await this.prisma.notification.findMany({
            where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
        return { items: rows, unread };
    }
    /** 标记单条已读（只能标自己的） */
    async markRead(userId, id) {
        const n = await this.prisma.notification.findFirst({ where: { id, userId } });
        if (!n)
            return { id, read: false };
        if (!n.readAt) {
            await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
        }
        const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
        return { id, read: true, unread };
    }
    /** 全部标为已读 */
    async markAllRead(userId) {
        const r = await this.prisma.notification.updateMany({
            where: { userId, readAt: null },
            data: { readAt: new Date() },
        });
        return { updated: r.count, unread: 0 };
    }
    /**
     * 后台：全站广播。
     *
     * 用 `createMany` 一次性写入；用户量大时分批（SQLite 单条 INSERT 上限
     * 受变量数限制，1000 一批足够安全）。
     */
    async broadcast(title, body, link) {
        const users = await this.prisma.user.findMany({
            where: { status: 'active' },
            select: { id: true },
        });
        const chunks = [];
        for (let i = 0; i < users.length; i += 500) {
            chunks.push(users.slice(i, i + 500).map((u) => u.id));
        }
        let sent = 0;
        for (const ids of chunks) {
            const r = await this.prisma.notification.createMany({
                data: ids.map((userId) => ({
                    userId,
                    type: 'broadcast',
                    title: title.slice(0, 120),
                    body: body.slice(0, 2000),
                    link: link ?? null,
                })),
            });
            sent += r.count;
        }
        return { sent, users: users.length };
    }
    /** 后台：模板列表 */
    async templates() {
        return this.prisma.messageTemplate.findMany({ orderBy: [{ channel: 'asc' }, { code: 'asc' }] });
    }
    /** 后台：新建或按 code 更新模板 */
    async upsertTemplate(input) {
        return this.prisma.messageTemplate.upsert({
            where: { code: input.code },
            update: {
                channel: input.channel,
                subject: input.subject ?? null,
                body: input.body,
                enabled: input.enabled ?? true,
            },
            create: {
                code: input.code,
                channel: input.channel,
                subject: input.subject ?? null,
                body: input.body,
                enabled: input.enabled ?? true,
            },
        });
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map