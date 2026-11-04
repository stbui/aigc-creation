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
var AdminAssetsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAssetsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const batch_1 = require("../common/batch");
const csv_1 = require("../common/csv");
const storage_service_1 = require("../storage/storage.service");
const signed_url_service_1 = require("../common/signed-url.service");
const page_query_dto_1 = require("./dto/page-query.dto");
/** 素材管理 (admin-prd.md §3.4 B-21~B-27) */
let AdminAssetsService = AdminAssetsService_1 = class AdminAssetsService {
    constructor(prisma, storage, signedUrl) {
        this.prisma = prisma;
        this.storage = storage;
        this.signedUrl = signedUrl;
        this.logger = new common_1.Logger(AdminAssetsService_1.name);
    }
    // ── 项目 (B-21/B-22) ────────────────────────────────────────────────
    /** 项目列表: 名称、所属用户、素材数、任务数、创建时间 */
    async listProjects(query) {
        const page = (0, page_query_dto_1.buildPage)(query, ['createdAt', 'name'], 'createdAt:desc');
        const where = {};
        if (query.keyword)
            where.name = { contains: query.keyword };
        if (query.ownerId)
            where.ownerId = query.ownerId;
        const [items, total] = await Promise.all([
            this.prisma.project.findMany({
                where,
                skip: page.skip,
                take: page.take,
                orderBy: page.orderBy,
                include: {
                    owner: { select: { id: true, email: true, name: true } },
                    _count: { select: { assets: true, tasks: true } },
                },
            }),
            this.prisma.project.count({ where }),
        ]);
        return (0, page_query_dto_1.paginate)(items.map((p) => ({
            id: p.id,
            name: p.name,
            ownerId: p.ownerId,
            ownerEmail: p.owner.email,
            ownerName: p.owner.name,
            assetCount: p._count.assets,
            taskCount: p._count.tasks,
            createdAt: p.createdAt,
        })), total, page);
    }
    /**
     * 删除项目 (B-22): 连带素材与任务。
     *
     * 硬删时先提交数据库事务，再尽力删除对象存储文件。反过来先删文件，
     * 一旦数据库事务失败，就会留下「记录还在、文件已丢」的坏数据；文件删除
     * 失败则只会留下孤儿文件，后续可清理，不会破坏业务记录。
     *
     * 软删只下架素材并保留文件 —— 否则素材记录虽然还在，内容却已经不可恢复。
     */
    async removeProject(id, hard) {
        const project = await this.prisma.project.findUnique({
            where: { id },
            include: {
                assets: { select: { id: true, storageKey: true, storageBackend: true } },
                tasks: { select: { id: true } },
            },
        });
        if (!project)
            throw new app_exception_1.AppError(40400, '项目不存在', 404);
        const impact = {
            assets: project.assets.length,
            tasks: project.tasks.length,
            bytes: 0,
        };
        // 统计字节数需要再查一次 Asset.sizeBytes
        const sizes = await this.prisma.asset.findMany({
            where: { projectId: id },
            select: { sizeBytes: true },
        });
        impact.bytes = sizes.reduce((sum, s) => sum + s.sizeBytes, 0);
        // 1) 数据库事务保证项目、任务与素材记录一致
        await this.prisma.$transaction(async (tx) => {
            await tx.generationTask.deleteMany({ where: { projectId: id } });
            if (hard) {
                await tx.asset.deleteMany({ where: { projectId: id } });
            }
            else {
                // 软删: 素材置下架而非删除 —— 记录保留便于追溯项目被删时素材去了哪
                await tx.asset.updateMany({
                    where: { projectId: id },
                    data: { status: 'hidden' },
                });
            }
            await tx.project.delete({ where: { id } });
        });
        // 2) 硬删提交后再清文件；删除失败只留孤儿文件，不影响已提交的数据事实
        if (hard)
            await this.deleteStoredAssets(project.assets);
        return { id, hard, impact };
    }
    // ── 素材 (B-23~B-27) ───────────────────────────────────────────────
    /**
     * 素材列表 (B-23/B-24)。
     *
     * 与用户端不同: **不过滤 status** —— 管理端必须能看到已下架素材,
     * 否则运营找不到"我下架过的东西在哪"。
     */
    async list(query) {
        const page = (0, page_query_dto_1.buildPage)(query, ['createdAt', 'sizeBytes'], 'createdAt:desc');
        const where = this.listWhere(query);
        const [items, total] = await Promise.all([
            this.prisma.asset.findMany({
                where,
                skip: page.skip,
                take: page.take,
                orderBy: page.orderBy,
                include: {
                    owner: { select: { id: true, email: true } },
                    project: { select: { id: true, name: true } },
                },
            }),
            this.prisma.asset.count({ where }),
        ]);
        return (0, page_query_dto_1.paginate)(items.map((a) => ({
            id: a.id,
            kind: a.kind,
            capability: a.capability,
            width: a.width,
            height: a.height,
            format: a.format,
            sizeBytes: a.sizeBytes,
            status: a.status,
            sourceUrl: this.signedUrl.displayUrl(a.sourceUrl),
            storageBackend: a.storageBackend,
            storageKey: a.storageKey,
            ownerId: a.ownerId,
            ownerEmail: a.owner.email,
            projectId: a.projectId,
            projectName: a.project.name,
            createdAt: a.createdAt,
        })), total, page);
    }
    /**
     * 导出素材 (CSV)。
     *
     * sourceUrl 用 displayUrl（签名开启时带签）—— 导出的表格里如果只有
     * 裸路径，打开就是 403，运营会以为"素材丢了"。
     */
    async exportCsv(query) {
        const rows = await this.prisma.asset.findMany({
            where: this.listWhere(query),
            orderBy: { createdAt: 'desc' },
            take: csv_1.CSV_EXPORT_MAX_ROWS,
            include: {
                owner: { select: { email: true } },
                project: { select: { name: true } },
            },
        });
        return (0, csv_1.toCsv)([
            { label: '素材 ID', value: (a) => a.id },
            { label: '类型', value: (a) => a.kind },
            { label: '能力', value: (a) => a.capability ?? '' },
            { label: '状态', value: (a) => a.status },
            { label: '宽', value: (a) => a.width ?? '' },
            { label: '高', value: (a) => a.height ?? '' },
            { label: '格式', value: (a) => a.format },
            { label: '大小(字节)', value: (a) => a.sizeBytes },
            { label: '存储后端', value: (a) => a.storageBackend },
            { label: '存储键', value: (a) => a.storageKey ?? '' },
            { label: '用户', value: (a) => a.owner.email },
            { label: '项目', value: (a) => a.project.name },
            { label: '地址', value: (a) => this.signedUrl.displayUrl(a.sourceUrl) },
            { label: '创建时间', value: (a) => a.createdAt },
        ], rows);
    }
    /**
     * 批量下架 / 恢复 / 删除（B7）。
     *
     * 与 `setStatusMany` 的区别：后者用一条 `updateMany`，快但只有总数、
     * 说不出哪条没成（比如 id 已不存在）；本方法逐条给出结果与原因。
     * 批量删除尤其需要逐条反馈 —— 用户要知道具体哪些删掉了。
     */
    async batchAction(ids, action) {
        return (0, batch_1.runBatch)(ids, async (id) => {
            if (action === 'delete')
                return this.remove(id);
            return this.setStatus(id, action === 'hide' ? 'hidden' : 'visible');
        });
    }
    /** 列表 / 导出共用的素材筛选条件 */
    listWhere(query) {
        const where = {};
        if (query.keyword) {
            where['OR'] = [{ id: { contains: query.keyword } }, { capability: { contains: query.keyword } }];
        }
        if (query.kind)
            where.kind = query.kind;
        if (query.capability)
            where.capability = query.capability;
        if (query.status)
            where.status = query.status;
        if (query.ownerId)
            where.ownerId = query.ownerId;
        if (query.projectId)
            where.projectId = query.projectId;
        if (query.backend)
            where.storageBackend = query.backend;
        if (query.from || query.to) {
            const createdAt = {};
            if (query.from)
                createdAt['gte'] = query.from;
            if (query.to)
                createdAt['lte'] = query.to;
            where['createdAt'] = createdAt;
        }
        return where;
    }
    /** 素材统计: 按状态/后端/类型分组, 供列表页顶部展示 */
    async stats() {
        const [total, byStatus, byBackend, byKind] = await Promise.all([
            this.prisma.asset.count(),
            this.prisma.asset.groupBy({ by: ['status'], _count: { _all: true } }),
            this.prisma.asset.groupBy({ by: ['storageBackend'], _count: { _all: true } }),
            this.prisma.asset.groupBy({ by: ['kind'], _count: { _all: true } }),
        ]);
        const bytes = await this.prisma.asset.aggregate({ _sum: { sizeBytes: true } });
        return {
            total,
            totalBytes: bytes._sum.sizeBytes ?? 0,
            totalMb: Math.round(((bytes._sum.sizeBytes ?? 0) / 1024 / 1024) * 100) / 100,
            byStatus: (() => {
                const m = {};
                for (const r of byStatus)
                    m[r.status] = r._count._all;
                return m;
            })(),
            byBackend: (() => {
                const m = {};
                for (const r of byBackend)
                    m[r.storageBackend] = r._count._all;
                return m;
            })(),
            byKind: (() => {
                const m = {};
                for (const r of byKind)
                    m[r.kind] = r._count._all;
                return m;
            })(),
        };
    }
    /**
     * 下架 / 恢复 (B-26)。
     *
     * 下架只改 status, **文件与记录都保留** —— 误操作可恢复。
     * 删除 (B-27) 是另一个动作, 不可逆。
     */
    async setStatus(id, status) {
        const asset = await this.prisma.asset.findUnique({ where: { id } });
        if (!asset)
            throw new app_exception_1.AppError(40400, '素材不存在', 404);
        await this.prisma.asset.update({ where: { id }, data: { status } });
        return { id, status };
    }
    /** 批量下架/恢复 */
    async setStatusMany(ids, status) {
        if (ids.length === 0)
            throw new app_exception_1.AppError(40001, '未选择素材', 400);
        const res = await this.prisma.asset.updateMany({
            where: { id: { in: ids } },
            data: { status },
        });
        return { count: res.count, status };
    }
    /**
     * 删除素材 (B-27): 连带磁盘文件与产出任务。
     *
     * 文件删除按**写入时的后端**, 不能用当前默认后端 —— 否则切换过
     * STORAGE_BACKEND 后老素材的云端文件永远删不掉。
     */
    async remove(id) {
        const asset = await this.prisma.asset.findUnique({
            where: { id },
            select: { id: true, storageKey: true, storageBackend: true },
        });
        if (!asset)
            throw new app_exception_1.AppError(40400, '素材不存在', 404);
        const removedTasks = await this.prisma.$transaction(async (tx) => {
            const tasks = await tx.generationTask.deleteMany({ where: { outputAssetId: id } });
            await tx.asset.delete({ where: { id } });
            return tasks.count;
        });
        // 数据库提交后再清文件；失败不回滚，避免记录还在但文件已丢
        await this.deleteStoredAssets([asset]);
        return { id, removedTasks };
    }
    /** 删除前的连带影响预览, 供确认弹窗量化展示 */
    async impact(id) {
        const asset = await this.prisma.asset.findUnique({ where: { id } });
        if (!asset)
            throw new app_exception_1.AppError(40400, '素材不存在', 404);
        const tasks = await this.prisma.generationTask.count({ where: { outputAssetId: id } });
        return { sizeBytes: asset.sizeBytes, tasks, storageBackend: asset.storageBackend };
    }
    /** 文件删除是提交后的 best-effort；失败留孤儿文件，不制造坏记录。 */
    async deleteStoredAssets(assets) {
        for (const asset of assets) {
            if (!asset.storageKey)
                continue;
            try {
                const provider = this.storage.get(asset.storageBackend ?? 'local');
                if (!provider) {
                    this.logger.warn(`素材文件未删除：存储后端 ${asset.storageBackend} 未启用 (${asset.storageKey})`);
                    continue;
                }
                await provider.delete(asset.storageKey);
            }
            catch (error) {
                this.logger.warn(`素材文件删除失败，数据库记录已删除: ${asset.storageKey} — ${error.message}`);
            }
        }
    }
};
exports.AdminAssetsService = AdminAssetsService;
exports.AdminAssetsService = AdminAssetsService = AdminAssetsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        storage_service_1.StorageService,
        signed_url_service_1.SignedUrlService])
], AdminAssetsService);
function parseDate(v) {
    if (typeof v !== 'string' || !v)
        return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
}
//# sourceMappingURL=assets-admin.service.js.map