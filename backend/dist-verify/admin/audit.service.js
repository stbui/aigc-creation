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
exports.AdminAuditService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const csv_1 = require("../common/csv");
const page_query_dto_1 = require("./dto/page-query.dto");
const SORTABLE = ['createdAt', 'action'];
let AdminAuditService = class AdminAuditService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /**
     * 审计日志查询。
     *
     * 只读: 后端不提供任何删除接口, 表设计上也只允许 INSERT。
     * 已知不足 —— 管理员仍可直接操作数据库删除 (彻底解决需独立存储或哈希链)。
     */
    async list(query) {
        const page = (0, page_query_dto_1.buildPage)(query, [...SORTABLE], 'createdAt:desc');
        const where = this.listWhere(query);
        const [items, total, actionGroups] = await Promise.all([
            this.prisma.adminAuditLog.findMany({
                where,
                skip: page.skip,
                take: page.take,
                orderBy: page.orderBy,
            }),
            this.prisma.adminAuditLog.count({ where }),
            // 动作筛选项: 从库里的实际数据聚合, 避免前端硬编码一份会过期的清单
            this.prisma.adminAuditLog.groupBy({ by: ['action'], _count: { _all: true } }),
        ]);
        // 操作人信息单独查: AdminAuditLog.actorId 是裸 String 无外键关系 ——
        // 系统产生的记录 (actorId='unknown') 不对应任何 User, 建立关系会在删除用户时
        // 留下悬空引用。分开查还能顺带处理「用户已注销/已删除」的降级展示。
        const actorIds = Array.from(new Set(items.map((r) => r.actorId)));
        const actors = await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, email: true, name: true },
        });
        const actorById = new Map(actors.map((a) => [a.id, a]));
        return {
            result: (0, page_query_dto_1.paginate)(items.map((row) => {
                const actor = actorById.get(row.actorId);
                return {
                    id: row.id,
                    createdAt: row.createdAt,
                    actorId: row.actorId,
                    actorEmail: actor?.email ?? '(系统或已删除)',
                    actorName: actor?.name ?? '',
                    actorRole: row.actorRole,
                    action: row.action,
                    targetType: row.targetType,
                    targetId: row.targetId,
                    detail: this.safeParse(row.detail),
                    reason: row.reason,
                    ip: row.ip,
                    success: row.success,
                };
            }), total, page),
            actions: actionGroups
                .map((g) => ({ action: g.action, count: g._count._all }))
                .sort((a, b) => b.count - a.count),
        };
    }
    /**
     * 导出审计日志 (CSV)。
     *
     * 与列表共用 `listWhere` —— 筛什么就导出什么, 否则会出现「列表 12 条、
     * 导出 4000 条」的口径分歧。上限 5000 行与其它后台导出一致。
     *
     * 详情列写 JSON: 审计的价值就在于举证, 只导「动作 + 对象」会丢掉变更内容。
     */
    async exportCsv(query) {
        const rows = await this.prisma.adminAuditLog.findMany({
            where: this.listWhere(query),
            orderBy: { createdAt: 'desc' },
            take: csv_1.CSV_EXPORT_MAX_ROWS,
        });
        const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
        const actors = await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, email: true, name: true },
        });
        const actorById = new Map(actors.map((a) => [a.id, a]));
        return (0, csv_1.toCsv)([
            { label: '时间', value: (r) => r.createdAt },
            { label: '操作人 ID', value: (r) => r.actorId },
            { label: '操作人邮箱', value: (r) => actorById.get(r.actorId)?.email ?? '(系统或已删除)' },
            { label: '操作人名称', value: (r) => actorById.get(r.actorId)?.name ?? '' },
            { label: '角色', value: (r) => r.actorRole },
            { label: '动作', value: (r) => r.action },
            { label: '对象类型', value: (r) => r.targetType },
            { label: '对象 ID', value: (r) => r.targetId },
            { label: '结果', value: (r) => (r.success ? '成功' : '失败') },
            { label: '原因', value: (r) => r.reason ?? '' },
            { label: 'IP', value: (r) => r.ip },
            { label: '详情', value: (r) => this.safeParse(r.detail) },
        ], rows);
    }
    /** 单条详情: 含操作前后的完整 detail */
    async detail(id) {
        const row = await this.prisma.adminAuditLog.findUnique({ where: { id } });
        if (!row)
            return null;
        const actor = await this.prisma.user.findUnique({
            where: { id: row.actorId },
            select: { email: true, name: true },
        });
        return {
            id: row.id,
            createdAt: row.createdAt,
            actorId: row.actorId,
            actorEmail: actor?.email ?? '(系统或已删除)',
            actorName: actor?.name ?? '',
            actorRole: row.actorRole,
            action: row.action,
            targetType: row.targetType,
            targetId: row.targetId,
            detail: this.safeParse(row.detail),
            reason: row.reason,
            ip: row.ip,
            success: row.success,
        };
    }
    /**
     * 列表与导出共用的筛选条件。
     *
     * 两处各写一份 where 是后台导出最容易出现的问题: 列表按 `success=false`
     * 筛出 3 条, 导出却把全部 4000 条写进文件。筛选项只在这里定义一次。
     */
    listWhere(query) {
        const where = {};
        if (query.actorId)
            where['actorId'] = query.actorId;
        if (query.action)
            where['action'] = query.action;
        if (query.targetId)
            where['targetId'] = query.targetId;
        if (query.success !== undefined)
            where['success'] = query.success;
        if (query.from || query.to) {
            const createdAt = {};
            const from = this.parseDate(query.from);
            const to = this.parseDate(query.to);
            if (from)
                createdAt['gte'] = from;
            if (to)
                createdAt['lte'] = to;
            if (Object.keys(createdAt).length > 0)
                where['createdAt'] = createdAt;
        }
        return where;
    }
    safeParse(raw) {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
        }
        catch {
            return { raw };
        }
    }
    parseDate(value) {
        if (!value)
            return undefined;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d;
    }
};
exports.AdminAuditService = AdminAuditService;
exports.AdminAuditService = AdminAuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminAuditService);
//# sourceMappingURL=audit.service.js.map