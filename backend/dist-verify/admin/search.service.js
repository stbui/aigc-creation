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
exports.AdminSearchService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const permissions_1 = require("./permissions");
/**
 * 后台全局搜索。
 *
 * ## 为什么是「每类取前 5」而不是统一分页
 *
 * 运营在顶栏搜索时手里通常只有一条线索：一个邮箱、一个订单号、一个工单号。
 * 他要的是「跳过去」而不是「在搜索结果里继续翻页」。统一分页会把 5 类结果
 * 拍平成一条混合流，反而要滚很久才找到真正要的那一类。
 *
 * 每类取 5 条、给出该类总数，用户点「查看全部」再带条件跳到对应列表页 ——
 * 列表页本来就有完整筛选，不必在搜索里重建一套。
 *
 * ## 匹配范围
 *
 * 只匹配**人能记住的字段**（邮箱、昵称、订单号、工单号、任务 id、素材地址）。
 * 不搜 params / content 这类长文本：LIKE 全表扫描在 SQLite 上代价高，
 * 且命中率低 —— 用户记不住自己三个月前写的提示词。
 */
/** 每类返回条数 */
const PER_GROUP = 5;
let AdminSearchService = class AdminSearchService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /**
     * @param grantedPermissions 当前后台角色实际拥有的权限点。搜索横跨多个领域,
     *   每个领域都必须单独用对应的 read 权限裁剪, 不能只凭 `data.search` 放行。
     */
    async search(rawQuery, grantedPermissions) {
        const q = (rawQuery ?? "").trim().slice(0, 80);
        if (q.length < 2) {
            /*
             * 单字符搜索返回空而不是报错：用户在输入过程中会连续触发请求，
             * 前几个字符被拒会让搜索框看起来「时好时坏」。
             * 真正需要拒的是**空串** —— 空串会把各表前 5 条全捞出来。
             */
            return { query: q, groups: emptyGroups(grantedPermissions), total: 0 };
        }
        const can = (permission) => grantedPermissions.includes(permission);
        const [usersResult, ordersResult, ticketsResult, tasksResult, assetsResult,] = await Promise.all([
            can(permissions_1.PERMISSIONS.userRead)
                ? Promise.all([
                    this.prisma.user.findMany({
                        where: {
                            OR: [
                                { email: { contains: q } },
                                { name: { contains: q } },
                                { id: q },
                            ],
                        },
                        orderBy: { createdAt: "desc" },
                        take: PER_GROUP,
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            role: true,
                            status: true,
                        },
                    }),
                    this.prisma.user.count({
                        where: {
                            OR: [
                                { email: { contains: q } },
                                { name: { contains: q } },
                                { id: q },
                            ],
                        },
                    }),
                ])
                : Promise.resolve(null),
            can(permissions_1.PERMISSIONS.orderRead)
                ? Promise.all([
                    this.prisma.order.findMany({
                        where: { OR: [{ orderNo: { contains: q } }, { id: q }] },
                        orderBy: { createdAt: "desc" },
                        take: PER_GROUP,
                        select: {
                            id: true,
                            orderNo: true,
                            status: true,
                            paidCents: true,
                            totalCents: true,
                            createdAt: true,
                            user: { select: { email: true } },
                        },
                    }),
                    this.prisma.order.count({
                        where: { OR: [{ orderNo: { contains: q } }, { id: q }] },
                    }),
                ])
                : Promise.resolve(null),
            can(permissions_1.PERMISSIONS.ticketRead)
                ? Promise.all([
                    this.prisma.ticket.findMany({
                        where: {
                            OR: [
                                { ticketNo: { contains: q } },
                                { subject: { contains: q } },
                                { id: q },
                            ],
                        },
                        orderBy: { createdAt: "desc" },
                        take: PER_GROUP,
                        select: {
                            id: true,
                            ticketNo: true,
                            subject: true,
                            status: true,
                            createdAt: true,
                        },
                    }),
                    this.prisma.ticket.count({
                        where: {
                            OR: [
                                { ticketNo: { contains: q } },
                                { subject: { contains: q } },
                                { id: q },
                            ],
                        },
                    }),
                ])
                : Promise.resolve(null),
            can(permissions_1.PERMISSIONS.taskRead)
                ? Promise.all([
                    this.prisma.generationTask.findMany({
                        where: {
                            OR: [{ id: { contains: q } }, { capability: { contains: q } }],
                        },
                        orderBy: { createdAt: "desc" },
                        take: PER_GROUP,
                        select: {
                            id: true,
                            capability: true,
                            status: true,
                            createdAt: true,
                            owner: { select: { email: true } },
                        },
                    }),
                    this.prisma.generationTask.count({
                        where: {
                            OR: [{ id: { contains: q } }, { capability: { contains: q } }],
                        },
                    }),
                ])
                : Promise.resolve(null),
            can(permissions_1.PERMISSIONS.assetRead)
                ? Promise.all([
                    this.prisma.asset.findMany({
                        where: {
                            OR: [{ id: { contains: q } }, { sourceUrl: { contains: q } }],
                        },
                        orderBy: { createdAt: "desc" },
                        take: PER_GROUP,
                        select: {
                            id: true,
                            sourceUrl: true,
                            kind: true,
                            capability: true,
                            createdAt: true,
                        },
                    }),
                    this.prisma.asset.count({
                        where: {
                            OR: [{ id: { contains: q } }, { sourceUrl: { contains: q } }],
                        },
                    }),
                ])
                : Promise.resolve(null),
        ]);
        const groups = [];
        if (usersResult) {
            const [users, userCount] = usersResult;
            groups.push({
                key: "users",
                label: "用户",
                total: userCount,
                items: users.map((u) => ({
                    id: u.id,
                    title: `${u.name} (${u.email})`,
                    subtitle: `${roleLabel(u.role)} · ${statusLabel(u.status)}`,
                    // 用户页已支持 ?id= 直接展开详情：搜索的目标是「看这个人」，
                    // 落到被邮箱筛过的列表后还要再点一次详情，多此一举。
                    link: `/admin/users?id=${encodeURIComponent(u.id)}`,
                })),
            });
        }
        if (ordersResult) {
            const [orders, orderCount] = ordersResult;
            groups.push({
                key: "orders",
                label: "订单",
                total: orderCount,
                items: orders.map((o) => ({
                    id: o.id,
                    title: o.orderNo,
                    subtitle: `${o.user?.email ?? ""} · ¥${yuan(o.paidCents > 0 ? o.paidCents : o.totalCents)} · ${o.status}`,
                    link: `/admin/orders?id=${encodeURIComponent(o.id)}`,
                })),
            });
        }
        if (ticketsResult) {
            const [tickets, ticketCount] = ticketsResult;
            groups.push({
                key: "tickets",
                label: "工单",
                total: ticketCount,
                items: tickets.map((t) => ({
                    id: t.id,
                    title: `${t.ticketNo} ${t.subject}`,
                    subtitle: t.status,
                    link: `/admin/tickets?id=${encodeURIComponent(t.id)}`,
                })),
            });
        }
        if (tasksResult) {
            const [tasks, taskCount] = tasksResult;
            groups.push({
                key: "tasks",
                label: "任务",
                total: taskCount,
                items: tasks.map((t) => ({
                    id: t.id,
                    title: `${t.capability} · ${t.id.slice(0, 10)}`,
                    subtitle: `${t.owner?.email ?? ""} · ${t.status}`,
                    link: `/admin/tasks?id=${encodeURIComponent(t.id)}`,
                })),
            });
        }
        if (assetsResult) {
            const [assets, assetCount] = assetsResult;
            groups.push({
                key: "assets",
                label: "素材",
                total: assetCount,
                items: assets.map((a) => ({
                    id: a.id,
                    title: a.sourceUrl.split("/").pop() ?? a.id,
                    subtitle: `${a.kind}${a.capability ? ` · ${a.capability}` : ""}`,
                    // 素材页没有详情抽屉, 但列表的 keyword 同时匹配 id 与能力名 ——
                    // 用 q 带过去即可让目标素材成为列表里唯一一行
                    link: `/admin/assets?q=${encodeURIComponent(a.id)}`,
                })),
            });
        }
        return {
            query: q,
            groups,
            total: groups.reduce((sum, group) => sum + group.total, 0),
        };
    }
};
exports.AdminSearchService = AdminSearchService;
exports.AdminSearchService = AdminSearchService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminSearchService);
function emptyGroups(grantedPermissions) {
    const can = (permission) => grantedPermissions.includes(permission);
    const groups = [
        { key: "users", label: "用户", permission: permissions_1.PERMISSIONS.userRead },
        { key: "orders", label: "订单", permission: permissions_1.PERMISSIONS.orderRead },
        { key: "tickets", label: "工单", permission: permissions_1.PERMISSIONS.ticketRead },
        { key: "tasks", label: "任务", permission: permissions_1.PERMISSIONS.taskRead },
        { key: "assets", label: "素材", permission: permissions_1.PERMISSIONS.assetRead },
    ];
    return groups
        .filter((group) => can(group.permission))
        .map(({ key, label }) => ({
        key,
        label,
        total: 0,
        items: [],
    }));
}
const ROLE_LABELS = {
    user: "普通用户",
    admin: "管理员",
    operator: "运营",
    finance: "财务",
};
const STATUS_LABELS = {
    active: "正常",
    disabled: "已禁用",
    deleted: "已注销",
};
function roleLabel(role) {
    return ROLE_LABELS[role] ?? role;
}
function statusLabel(status) {
    return STATUS_LABELS[status] ?? status;
}
function yuan(cents) {
    return (cents / 100).toFixed(2);
}
//# sourceMappingURL=search.service.js.map