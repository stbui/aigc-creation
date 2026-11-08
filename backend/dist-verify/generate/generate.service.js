"use strict";
/**
 * 生成任务的读写门面。
 *
 * 本文件只剩两件事：
 *   1. **写入口**：`createTask` 把请求交给 `TaskAdmissionService`（准入 +
 *      预留），建好的任务由 `TaskWorkerService` 异步执行；
 *   2. **读接口**：任务详情 / 列表 / 删除，产物按需签名。
 *
 * 执行链路（派发、轮询、切线、落盘、结算）已全部迁到 `src/model/tasks/**`。
 * 这里不再持有任何协议或计费逻辑 —— 同一份「建任务」逻辑出现两处，
 * 迟早会出现「后台重试走的路径不扣费、C 端走的路径扣费」这类分叉。
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
var GenerateService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const storage_service_1 = require("../storage/storage.service");
const signed_url_service_1 = require("../common/signed-url.service");
const env_files_1 = require("../config/env-files");
const task_admission_service_1 = require("../model/tasks/task-admission.service");
const task_lifecycle_service_1 = require("../model/tasks/task-lifecycle.service");
const task_worker_service_1 = require("../model/tasks/task-worker.service");
let GenerateService = GenerateService_1 = class GenerateService {
    constructor(prisma, storage, signedUrl, admission, lifecycle, worker) {
        this.prisma = prisma;
        this.storage = storage;
        this.signedUrl = signedUrl;
        this.admission = admission;
        this.lifecycle = lifecycle;
        this.worker = worker;
        this.logger = new common_1.Logger(GenerateService_1.name);
    }
    /** 建任务：准入 → 计价 → 预留 → 排队，随后由 worker 异步执行 */
    async createTask(ownerId, dto, idempotencyHeader) {
        const result = await this.admission.admit({ ownerId, dto, idempotencyHeader });
        // 新任务立即调度一轮，省掉最多一个调度节拍的等待；幂等命中不重复调度
        if (!result.idempotentHit)
            this.worker.kick();
        return result;
    }
    /**
     * 投递任务（后台重试复用）。
     *
     * 公开而非让调用方自己触发：调度时机与「失败不冒泡」这两个语义必须
     * 收在一处，散落在两处迟早漂移。
     */
    enqueue(taskId) {
        void taskId;
        this.worker.kick();
    }
    /**
     * 后台重试失败任务：**新建任务而非原地复活**。
     *
     * `outputAssetId` 是 `@unique` 的 1:1 关系，原地复活会让新产出与旧产出
     * 抢同一个唯一键。重试不二次扣费，因此 `creditCost` 记 0、不建账单；
     * worker 对「零价且无账单」的任务照常执行，失败也不会退款（本来就没扣）。
     *
     * 改造前创建的存量任务没有 `logicalModelId`，无法重新解析线路，明确拒绝
     * 而不是让它排队后立刻 42204 —— 那样运营会以为「重试过了」。
     */
    async retryTask(id) {
        const origin = await this.prisma.generationTask.findUnique({ where: { id } });
        if (!origin)
            throw new app_exception_1.AppError(40400, '任务不存在', 404);
        if (origin.status !== 'failed')
            throw new app_exception_1.AppError(40000, '仅失败任务可重试', 400);
        if (origin.errorCode === task_lifecycle_service_1.TASK_ERROR.uncertain) {
            // 上游可能已经受理并计费；直接重试会二次计费，必须先人工核对账单
            throw new app_exception_1.AppError(40000, '结果不明的任务不能直接重试，请先核对上游账单', 400);
        }
        if (!origin.logicalModelId) {
            throw new app_exception_1.AppError(40000, '改造前创建的存量任务没有模型快照，无法重试', 400);
        }
        const next = await this.prisma.generationTask.create({
            data: {
                projectId: origin.projectId,
                ownerId: origin.ownerId,
                capability: origin.capability,
                status: 'queued',
                stage: '排队中',
                inputAssetIds: origin.inputAssetIds,
                params: origin.params,
                provider: 'gateway',
                creditCost: 0,
                logicalModelId: origin.logicalModelId,
                logicalModelRevisionId: origin.logicalModelRevisionId,
                routeId: origin.routeId,
                channelModelId: origin.channelModelId,
                // 新的一轮：attempt 编号从 1 重来，历史尝试留在原任务上可追溯
                routeRun: origin.routeRun + 1,
                retriedFromId: origin.id,
                heartbeatAt: new Date(),
            },
        });
        this.worker.kick();
        this.logger.log(`任务 ${id} 重试为新任务 ${next.id}`);
        return { taskId: next.id, retriedFromId: origin.id };
    }
    /**
     * 后台终止任务。
     *
     * 已派发的任务不能自动退款（上游可能正在生成并计费）：任务置 `cancelled`，
     * 账单转 `uncertain` 等人工核对；未派发的直接退款。
     */
    async cancelTask(id) {
        const result = await this.lifecycle.cancel(id, '后台终止');
        this.logger.warn(`任务 ${id} 被后台终止，计费状态 ${result.billing}`);
        return { id, status: result.status, billing: result.billing };
    }
    /**
     * 回收租约过期的任务（调度任务 `task-recover` 调用）。
     *
     * 真正的判定在 worker：按 attempt 的 `dispatchState` 决定续跑 / 失败 /
     * 待人工核对。这里只做转发，避免出现两套「孤儿任务」定义。
     */
    async recoverOrphanTasks() {
        return this.worker.recoverStaleTasks();
    }
    async getTask(ownerId, id) {
        const task = await this.prisma.generationTask.findUnique({ where: { id } });
        if (!task || task.ownerId !== ownerId) {
            throw new app_exception_1.AppError(40001, '任务不存在或无权限', 403);
        }
        const outputIds = orderedOutputIds(task.outputAssetId, task.outputAssetIds);
        const outputs = outputIds.length
            ? await this.prisma.asset.findMany({ where: { id: { in: outputIds } } })
            : [];
        const outputById = new Map(outputs.map((asset) => [asset.id, asset]));
        const outputAssets = outputIds
            .map((assetId) => outputById.get(assetId))
            .filter((asset) => Boolean(asset))
            .map((asset) => this.serializeOutputAsset(asset, task.ownerId));
        const inputAssetIds = parseIdList(task.inputAssetIds);
        const inputRows = inputAssetIds.length
            ? await this.prisma.asset.findMany({ where: { id: { in: inputAssetIds } } })
            : [];
        const inputById = new Map(inputRows.map((asset) => [asset.id, asset]));
        const inputAssets = inputAssetIds
            .map((assetId) => inputById.get(assetId))
            .filter((asset) => Boolean(asset))
            .map((asset) => this.serializeOutputAsset(asset, task.ownerId));
        return {
            id: task.id,
            projectId: task.projectId,
            capability: task.capability,
            status: task.status,
            inputAssetIds,
            // 结果行要展示「原图」：只给 id 的话前端还得再查一次素材，且查不到已删除的
            inputAssets,
            parentTaskId: task.parentTaskId,
            params: JSON.parse(task.params || '{}'),
            provider: task.provider,
            errorCode: task.errorCode,
            // 作品页「重新生成」凭它沿用原模型；改造前的存量任务为 null
            logicalModelId: task.logicalModelId,
            // 本次实际扣掉的积分快照：前端结果卡据此显示「本次消耗 N 积分」，
            // 与建任务时的价一致，不受后续改价影响
            creditCost: task.creditCost,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            // outputAsset 保留为首项，兼容既有结果卡与历史；outputAssets 是新契约。
            outputAsset: outputAssets[0] ?? null,
            outputAssets,
        };
    }
    /** 删除作品：连带删除其产出的生成图与磁盘文件（作品 = 任务 + 产物） */
    async removeTask(ownerId, id) {
        const task = await this.prisma.generationTask.findUnique({ where: { id } });
        if (!task || task.ownerId !== ownerId) {
            throw new app_exception_1.AppError(40001, '任务不存在或无权限', 403);
        }
        /*
         * 一次生成按模块拆成的多张图里, 其余任务由 `parentTaskId` 指向父任务。
         * 删除父任务必须整批删除 —— 只删父任务会留下一行缺原图、只剩几张模块图
         * 的孤立残片, 用户没法再选中整条记录删掉。删除某张子任务时只删它自己。
         */
        const batch = await this.prisma.generationTask.findMany({
            where: { OR: [{ id: task.id }, { parentTaskId: task.id }] },
            select: { id: true, outputAssetId: true, outputAssetIds: true },
        });
        const targets = batch.length > 0 ? batch : [task];
        const outputIds = targets.flatMap((row) => orderedOutputIds(row.outputAssetId, row.outputAssetIds));
        const outputs = outputIds.length
            ? await this.prisma.asset.findMany({ where: { id: { in: outputIds } } })
            : [];
        await this.prisma.generationTask.deleteMany({ where: { id: { in: targets.map((row) => row.id) } } });
        const removedAsset = outputs.length > 0;
        if (outputs.length > 0) {
            await this.prisma.asset
                .deleteMany({ where: { id: { in: outputs.map((asset) => asset.id) } } })
                .catch(() => undefined);
        }
        /*
         * 文件按**写入时的后端**删除，失败不阻塞（库已删，留文件无害）。
         * 必须走 StorageService 而不是拼本地路径：素材可能落在 oss/minio，
         * 那里没有 /uploads/ 前缀，按本地路径推导只会静默漏删。
         */
        for (const out of outputs) {
            if (out.storageKey) {
                const backend = out.storageBackend ?? 'local';
                await this.storage.get(backend)?.delete(out.storageKey).catch(() => undefined);
            }
            else if (out.sourceUrl?.startsWith('/uploads/')) {
                const parts = out.sourceUrl.replace(/^\/uploads\//, '').split('/').filter(Boolean);
                if (parts.length === 2 && !parts.some((p) => p.includes('..'))) {
                    await (0, promises_1.unlink)((0, path_1.join)((0, env_files_1.resolveUploadsDir)(), parts[0], parts[1])).catch(() => undefined);
                }
            }
        }
        return { id, removedAsset };
    }
    async listTasks(ownerId, projectId) {
        const where = { ownerId };
        if (projectId)
            where.projectId = projectId;
        const tasks = await this.prisma.generationTask.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { outputAsset: true },
        });
        return this.serializeTasks(tasks);
    }
    /**
     * 分页任务列表。
     *
     * `/tasks` 旧接口保留全量数组（修图历史等小范围使用）；作品页和结果栏
     * 改用这个分页接口，避免用户任务积累到几千条后每次进页面都拉全量。
     */
    async listTasksPage(ownerId, params = {}) {
        const take = Math.min(Math.max(Number(params.limit) || 50, 1), 100);
        const skip = Math.max(Number(params.offset) || 0, 0);
        const where = { ownerId };
        if (params.projectId)
            where.projectId = params.projectId;
        if (params.capability)
            where.capability = params.capability;
        const [tasks, total] = await Promise.all([
            this.prisma.generationTask.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take,
                include: { outputAsset: true },
            }),
            this.prisma.generationTask.count({ where }),
        ]);
        return {
            items: await this.serializeTasks(tasks),
            total,
            limit: take,
            offset: skip,
        };
    }
    /** 把任务行及其输入/产出素材一次性组装成前端稳定形状 */
    async serializeTasks(tasks) {
        const allOutputIds = Array.from(new Set(tasks.flatMap((task) => orderedOutputIds(task.outputAssetId, task.outputAssetIds))));
        const outputRows = allOutputIds.length
            ? await this.prisma.asset.findMany({ where: { id: { in: allOutputIds } } })
            : [];
        const outputById = new Map(outputRows.map((asset) => [asset.id, asset]));
        // 输入图一次性取回：详情图结果行要按批次展示「原图」，逐任务查会放大到 N 次往返
        const inputIdsByTask = new Map(tasks.map((t) => [t.id, parseIdList(t.inputAssetIds)]));
        const allInputIds = Array.from(new Set([...inputIdsByTask.values()].flat()));
        const inputRows = allInputIds.length
            ? await this.prisma.asset.findMany({ where: { id: { in: allInputIds } } })
            : [];
        const inputById = new Map(inputRows.map((asset) => [asset.id, asset]));
        return tasks.map((t) => {
            const inputAssetIds = inputIdsByTask.get(t.id) ?? [];
            const inputAssets = inputAssetIds
                .map((assetId) => inputById.get(assetId))
                .filter((asset) => Boolean(asset))
                .map((asset) => this.serializeOutputAsset(asset, t.ownerId));
            /*
             * 产出素材被后台下架（status='hidden'）的不再下发。没有产出的任务
             * （失败 / 进行中）照常保留 —— 它们不是「被下架」，而是本来就没有图。
             */
            const outputAssets = orderedOutputIds(t.outputAssetId, t.outputAssetIds)
                .map((assetId) => outputById.get(assetId))
                .filter((asset) => asset?.status === 'visible')
                .map((asset) => this.serializeOutputAsset(asset, t.ownerId));
            return {
                id: t.id,
                projectId: t.projectId,
                capability: t.capability,
                status: t.status,
                inputAssetIds,
                // 结果行展示「原图」用；缺图（素材已删）时前端按商品名称占位
                inputAssets,
                parentTaskId: t.parentTaskId,
                params: JSON.parse(t.params || '{}'),
                provider: t.provider,
                errorCode: t.errorCode,
                logicalModelId: t.logicalModelId,
                creditCost: t.creditCost,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                outputAsset: outputAssets[0] ?? null,
                outputAssets,
            };
        });
    }
    /** 把任务里的素材记录转成前端任务接口的稳定形状。 */
    serializeOutputAsset(output, ownerId) {
        return {
            id: output.id,
            sourceUrl: output.sourceUrl,
            signedUrl: this.signedUrl.sign(output.sourceUrl, { userId: ownerId }),
            aigc: parseAigcMeta(output.aigcMeta),
            capability: output.capability,
            width: output.width,
            height: output.height,
            format: output.format,
            durationMs: output.durationMs ?? null,
            // 产出模态由 mime 推导，不能用能力当前声明的模态倒推历史文件。
            modality: output.format?.startsWith('video/') ? 'video' : 'image',
        };
    }
};
exports.GenerateService = GenerateService;
exports.GenerateService = GenerateService = GenerateService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        storage_service_1.StorageService,
        signed_url_service_1.SignedUrlService,
        task_admission_service_1.TaskAdmissionService,
        task_lifecycle_service_1.TaskLifecycleService,
        task_worker_service_1.TaskWorkerService])
], GenerateService);
function parseAigcMeta(raw) {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
/** 任务里 JSON 数组字符串 → 去空的 id 列表（`inputAssetIds` 用） */
function parseIdList(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed))
            return [];
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
/** 产出素材 id 列表：首项优先，顺次去重（历史任务只有 outputAssetId） */
function orderedOutputIds(primaryId, idsJson) {
    const ids = [];
    if (primaryId)
        ids.push(primaryId);
    try {
        const parsed = JSON.parse(idsJson || '[]');
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                const id = String(item ?? '').trim();
                if (id && !ids.includes(id))
                    ids.push(id);
            }
        }
    }
    catch {
        // 历史脏数据：只剩首项可用
    }
    return ids;
}
//# sourceMappingURL=generate.service.js.map