"use strict";
/**
 * 用户分组后台管理：可见渠道、倍率、货币兑换、模型级覆盖。
 *
 * 移植自 open-ai-canvas `internal/app/user_groups.go` 的 `AdminUserGroups` /
 * `CreateUserGroup` / `UpdateUserGroup` / `DeleteUserGroup`。
 *
 * 本仓没有 `users.user_group` 列：分组由「会员套餐 → `MembershipPlan.userGroupCode`」
 * 映射得到（`docs/channel-model-design.md` §14.2）。因此「分组下的用户数」按
 * 有效会员（active / grace）的计划映射统计，没有有效会员的用户计入默认分组。
 *
 * 写入后必须同时做两件事：`UserGroupService.invalidate()` 清进程内缓存，
 * `CatalogVersionService.invalidate()` 让目录快照重载 —— 只做其中一件会出现
 * 「目录已按新倍率展示、报价仍按旧倍率扣费」的资损级错位。
 */
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
exports.UserGroupAdminService = void 0;
exports.normalizeOverrides = normalizeOverrides;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("../../common/app.exception");
const prisma_service_1 = require("../../prisma/prisma.service");
const json_1 = require("../domain/json");
const catalog_version_service_1 = require("../infra/catalog-version.service");
const user_group_service_1 = require("./user-group.service");
const USER_GROUP_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BADGE_STYLES = ['none', 'vip', 'svip'];
/** 100 倍（10000 = 1.0） */
const MAX_RATIO_BASIS_POINTS = 1_000_000;
/** 单种货币最多兑换 100 万积分（微积分口径） */
const MAX_POINTS_MICROCREDITS = 1_000_000 * 1_000_000;
const MAX_OVERRIDES = 500;
const MAX_SORT_ORDER = 999_999;
let UserGroupAdminService = class UserGroupAdminService {
    constructor(prisma, groups, catalogVersion) {
        this.prisma = prisma;
        this.groups = groups;
        this.catalogVersion = catalogVersion;
    }
    /* ───────────────────────── 查询 ───────────────────────── */
    async list() {
        const rows = await this.prisma.userGroup.findMany({
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const links = rows.length
            ? await this.prisma.userGroupChannel.findMany({
                where: { groupId: { in: rows.map((row) => row.id) } },
            })
            : [];
        const counts = await this.userCountsByGroupCode();
        return rows.map((row) => this.toView(row, links, counts));
    }
    async get(id) {
        const view = (await this.list()).find((item) => item.id === id);
        if (!view)
            throw notFound();
        return view;
    }
    /* ───────────────────────── 写入 ───────────────────────── */
    async create(req) {
        const code = String(req.code ?? '').trim().toLowerCase();
        if (!USER_GROUP_CODE_PATTERN.test(code)) {
            throw badRequest('分组编码只能使用小写字母、数字、下划线或连字符，最多 40 位');
        }
        const exists = await this.prisma.userGroup.findFirst({
            where: { code, deletedAt: null },
            select: { id: true },
        });
        if (exists)
            throw badRequest('分组编码已存在');
        const prepared = await this.prepare(req, null);
        const created = await this.prisma.$transaction(async (tx) => {
            const group = await tx.userGroup.create({
                data: {
                    code,
                    activeKey: code,
                    name: prepared.name,
                    description: prepared.description,
                    badgeLabel: prepared.badgeLabel,
                    badgeStyle: prepared.badgeStyle,
                    sortOrder: prepared.sortOrder,
                    ratioBasisPoints: prepared.ratioBasisPoints,
                    pointsPerUsd: BigInt(prepared.pointsPerUsd),
                    pointsPerCny: BigInt(prepared.pointsPerCny),
                    allChannels: prepared.allChannels,
                    modelOverridesJson: JSON.stringify(prepared.overrides),
                },
            });
            await this.replaceChannels(tx, group.id, prepared.channelIds);
            return group;
        });
        this.invalidate();
        return this.get(created.id);
    }
    async update(id, req) {
        const existing = await this.requireGroup(id);
        const requestedCode = String(req.code ?? '').trim().toLowerCase();
        if (requestedCode !== '' && requestedCode !== existing.code) {
            throw badRequest('分组编码创建后不能修改');
        }
        const prepared = await this.prepare(req, existing.id);
        await this.prisma.$transaction(async (tx) => {
            await tx.userGroup.update({
                where: { id: existing.id },
                data: {
                    name: prepared.name,
                    description: prepared.description,
                    badgeLabel: prepared.badgeLabel,
                    badgeStyle: prepared.badgeStyle,
                    sortOrder: prepared.sortOrder,
                    ratioBasisPoints: prepared.ratioBasisPoints,
                    pointsPerUsd: BigInt(prepared.pointsPerUsd),
                    pointsPerCny: BigInt(prepared.pointsPerCny),
                    allChannels: prepared.allChannels,
                    modelOverridesJson: JSON.stringify(prepared.overrides),
                },
            });
            await this.replaceChannels(tx, existing.id, prepared.channelIds);
        });
        this.invalidate();
        return this.get(existing.id);
    }
    /**
     * 删除（软删除）：有会员套餐映射到该分组时拒绝。
     *
     * 分组被删除后 `resolvedGroup` 会失败关闭（40301），继续放行删除等于
     * 把一批会员变成「分组配置无效」；必须先改套餐映射再删分组。
     */
    async remove(id) {
        const existing = await this.requireGroup(id);
        if (existing.code === user_group_service_1.DEFAULT_USER_GROUP_CODE)
            throw badRequest('默认分组不能删除');
        const plans = await this.prisma.membershipPlan.findMany({
            where: { userGroupCode: existing.code },
            select: { code: true },
        });
        if (plans.length > 0) {
            throw badRequest(`仍有会员套餐映射到该分组（${plans.map((plan) => plan.code).join('、')}），请先调整套餐`);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.userGroupChannel.deleteMany({ where: { groupId: existing.id } });
            await tx.userGroup.update({
                where: { id: existing.id },
                data: { deletedAt: new Date(), activeKey: null },
            });
        });
        this.invalidate();
    }
    /* ───────────────────────── 内部 ───────────────────────── */
    async prepare(req, excludingId) {
        const name = String(req.name ?? '').trim();
        if (name === '' || [...name].length > 80)
            throw badRequest('分组名称不能为空且不能超过 80 字');
        const description = String(req.description ?? '').trim();
        if ([...description].length > 500)
            throw badRequest('分组说明不能超过 500 字');
        const badgeLabel = String(req.badgeLabel ?? '').trim();
        if ([...badgeLabel].length > 16)
            throw badRequest('徽章文字不能超过 16 字');
        const badgeStyle = String(req.badgeStyle ?? '').trim().toLowerCase() || 'none';
        if (!BADGE_STYLES.includes(badgeStyle))
            throw badRequest('徽章样式无效');
        const sortOrder = Math.trunc(Number(req.sortOrder ?? 0));
        if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > MAX_SORT_ORDER) {
            throw badRequest(`排序值必须在 0-${MAX_SORT_ORDER} 之间`);
        }
        const ratioBasisPoints = Math.trunc(Number(req.ratioBasisPoints ?? 10_000));
        if (!Number.isFinite(ratioBasisPoints) || ratioBasisPoints <= 0 || ratioBasisPoints > MAX_RATIO_BASIS_POINTS) {
            throw badRequest('分组倍率必须在 0.0001-100 倍之间');
        }
        const pointsPerUsd = (0, json_1.toSafeAmount)(req.pointsPerUsdMicrocredits, 'USD 兑换比例');
        const pointsPerCny = (0, json_1.toSafeAmount)(req.pointsPerCnyMicrocredits, 'CNY 兑换比例');
        if (pointsPerUsd > MAX_POINTS_MICROCREDITS || pointsPerCny > MAX_POINTS_MICROCREDITS) {
            throw badRequest('货币兑换积分比例必须在 0 至 100 万积分之间');
        }
        const overrides = normalizeOverrides(req.modelOverrides);
        const allChannels = Boolean(req.allChannels);
        let channelIds = [];
        if (!allChannels) {
            channelIds = (0, json_1.uniqueNonEmpty)(req.channelIds ?? []).sort();
            if (channelIds.length > 0) {
                const channels = await this.prisma.modelChannel.findMany({
                    where: { id: { in: channelIds }, scope: 'system', deletedAt: null },
                    select: { id: true },
                });
                if (channels.length !== channelIds.length) {
                    throw badRequest('分组绑定的系统渠道不存在或已删除');
                }
            }
        }
        void excludingId;
        return {
            name,
            description,
            badgeLabel,
            badgeStyle,
            sortOrder,
            ratioBasisPoints,
            pointsPerUsd,
            pointsPerCny,
            overrides,
            allChannels,
            channelIds,
        };
    }
    async replaceChannels(db, groupId, channelIds) {
        await db.userGroupChannel.deleteMany({ where: { groupId } });
        if (channelIds.length === 0)
            return;
        await db.userGroupChannel.createMany({
            data: channelIds.map((channelId) => ({ groupId, channelId })),
        });
    }
    invalidate() {
        // 缓存与目录版本都必须失效：只清一个会让展示价与扣费价错位
        this.groups.invalidate();
        this.catalogVersion.invalidate();
    }
    async requireGroup(id) {
        const key = String(id ?? '').trim();
        const row = key
            ? await this.prisma.userGroup.findFirst({ where: { id: key, deletedAt: null } })
            : null;
        if (!row)
            throw notFound();
        return row;
    }
    toView(row, links, counts) {
        const code = (0, user_group_service_1.normalizeUserGroupCode)(row.code);
        return {
            id: row.id,
            code,
            name: row.name,
            description: row.description,
            badgeLabel: row.badgeLabel,
            badgeStyle: row.badgeStyle,
            sortOrder: row.sortOrder,
            ratioBasisPoints: row.ratioBasisPoints,
            pointsPerUsdMicrocredits: Number(row.pointsPerUsd),
            pointsPerCnyMicrocredits: Number(row.pointsPerCny),
            allChannels: row.allChannels,
            channelIds: links.filter((link) => link.groupId === row.id).map((link) => link.channelId).sort(),
            modelOverrides: decodeOverrides(row.modelOverridesJson),
            userCount: counts.get(code) ?? 0,
            isDefault: code === user_group_service_1.DEFAULT_USER_GROUP_CODE,
        };
    }
    /**
     * 每个分组的用户数（按有效会员的套餐映射）。没有有效会员的用户计入默认分组 ——
     * `groupCodeForUser` 对这类用户返回默认分组，计数口径必须与计费口径一致。
     */
    async userCountsByGroupCode() {
        const [memberships, plans, totalUsers] = await Promise.all([
            this.prisma.membership.findMany({
                where: { status: { in: ['active', 'grace'] } },
                select: { userId: true, planId: true },
            }),
            this.prisma.membershipPlan.findMany({ select: { id: true, userGroupCode: true } }),
            this.prisma.user.count({ where: { status: { not: 'deleted' } } }),
        ]);
        const codeByPlanId = new Map(plans.map((plan) => [plan.id, (0, user_group_service_1.normalizeUserGroupCode)(plan.userGroupCode)]));
        const usersByCode = new Map();
        const coveredUsers = new Set();
        for (const membership of memberships) {
            const code = codeByPlanId.get(membership.planId) ?? user_group_service_1.DEFAULT_USER_GROUP_CODE;
            coveredUsers.add(membership.userId);
            const bucket = usersByCode.get(code) ?? new Set();
            bucket.add(membership.userId);
            usersByCode.set(code, bucket);
        }
        const result = new Map();
        for (const [code, users] of usersByCode)
            result.set(code, users.size);
        result.set(user_group_service_1.DEFAULT_USER_GROUP_CODE, (result.get(user_group_service_1.DEFAULT_USER_GROUP_CODE) ?? 0) + Math.max(0, totalUsers - coveredUsers.size));
        return result;
    }
};
exports.UserGroupAdminService = UserGroupAdminService;
exports.UserGroupAdminService = UserGroupAdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        user_group_service_1.UserGroupService,
        catalog_version_service_1.CatalogVersionService])
], UserGroupAdminService);
/* ────────────────────────── 纯函数 ────────────────────────── */
function notFound() {
    return new app_exception_1.AppError(40400, '用户分组不存在', 404);
}
function badRequest(message) {
    return new app_exception_1.AppError(40001, message, 400);
}
/** 覆盖项：去重、排序、丢弃全零项（全零等于没配置，留着只会让页面对不上） */
function normalizeOverrides(items) {
    const list = Array.isArray(items) ? items : [];
    if (list.length > MAX_OVERRIDES)
        throw badRequest(`单个分组最多配置 ${MAX_OVERRIDES} 个模型倍率`);
    const result = [];
    const seen = new Set();
    for (const item of list) {
        const modelKey = String(item?.modelKey ?? '').trim().replace(/^models\//, '');
        if (modelKey === '' || [...modelKey].length > 120) {
            throw badRequest('模型倍率的模型标识不能为空且不能超过 120 字');
        }
        if (seen.has(modelKey))
            throw badRequest(`模型 ${modelKey} 重复配置了倍率`);
        seen.add(modelKey);
        const ratioBasisPoints = optionalAmount(item?.ratioBasisPoints);
        const pointsPerUsd = optionalAmount(item?.pointsPerUsd);
        const pointsPerCny = optionalAmount(item?.pointsPerCny);
        if (ratioBasisPoints !== undefined && ratioBasisPoints > MAX_RATIO_BASIS_POINTS) {
            throw badRequest(`模型 ${modelKey} 的倍率必须在 0.0001-100 之间`);
        }
        if ((pointsPerUsd !== undefined && pointsPerUsd > MAX_POINTS_MICROCREDITS) ||
            (pointsPerCny !== undefined && pointsPerCny > MAX_POINTS_MICROCREDITS)) {
            throw badRequest(`模型 ${modelKey} 的货币兑换积分比例无效`);
        }
        if (!ratioBasisPoints && !pointsPerUsd && !pointsPerCny)
            continue;
        result.push({ modelKey, ratioBasisPoints, pointsPerUsd, pointsPerCny });
    }
    return result.sort((left, right) => (left.modelKey < right.modelKey ? -1 : 1));
}
function optionalAmount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}
function decodeOverrides(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed)
            ? parsed
                .map((item) => ({
                modelKey: String(item?.modelKey ?? ''),
                ratioBasisPoints: optionalAmount(item?.ratioBasisPoints),
                pointsPerUsd: optionalAmount(item?.pointsPerUsd),
                pointsPerCny: optionalAmount(item?.pointsPerCny),
            }))
                .filter((item) => item.modelKey !== '')
            : [];
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=user-group.admin.service.js.map