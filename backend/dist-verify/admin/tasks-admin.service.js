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
var TasksAdminService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksAdminService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const generate_service_1 = require("../generate/generate.service");
const app_exception_1 = require("../common/app.exception");
const batch_1 = require("../common/batch");
const csv_1 = require("../common/csv");
const capability_registry_1 = require("../capabilities/capability.registry");
const page_query_dto_1 = require("./dto/page-query.dto");
const signed_url_service_1 = require("../common/signed-url.service");
/** 可排序列白名单: status/createdAt/updatedAt 都是 SQLite 上的真实列 */
const SORTABLE = ['createdAt', 'updatedAt', 'status', 'capability'];
/**
 * provider 的历史初始值 `mock` 与现在的 `pending` 同义 (2026-10-22 更名)。
 *
 * 迁移脚本 `db:migrate:provider` 会把存量行改写, 但**读取侧仍要归一**:
 * 迁移可能还没跑, 且用户可能拿旧库连新代码。筛选要覆盖两种写法,
 * 展示与分组只出 `pending` —— 否则后台「待执行」那一档在迁移前会是空的。
 */
const LEGACY_PENDING_PROVIDER = 'mock';
function normalizeProvider(value) {
    if (!value)
        return null;
    return value === LEGACY_PENDING_PROVIDER ? 'pending' : value;
}
/**
 * 拥堵告警阈值 (admin-prd.md B-31)。
 *
 * running 超过此值即视为「排队已经堆起来了」—— 生成任务并发受会员等级限制,
 * 单用户并发上限之外还受模型通道实际吞吐约束, running 长期不降说明
 * 通道侧跟不上提交速度, 此时用户端表现为"一直转圈"。
 *
 * 取 50 而非更小值: 阈值太低会让正常业务高峰频繁误报, 告警一旦养成
 * 无视习惯就失去意义。
 */
const RUNNING_ALERT_THRESHOLD = 50;
/** 近 1 小时失败数统计窗口 */
const RECENT_FAIL_WINDOW_MS = 3600 * 1000;
/**
 * 任务监控 (admin-prd.md B-28~B-33 / admin-detailed-design.md §5)。
 *
 * 与相邻两个模块的分工:
 *   - 「模型调用记录」记的是**每次调模型**的明细 (含回落与提示词)
 *   - 「操作审计」记的是**谁在后台做了什么**
 *   - 本模块记的是**任务实体**本身: 状态、输入、参数、产出、重试链
 *
 * 重试与终止都挂审计: 二者都会真实改变用户可见的任务状态与积分核算口径,
 * 事后必须能回答"这个失败任务是谁重跑的、为什么被杀掉"。
 */
let TasksAdminService = TasksAdminService_1 = class TasksAdminService {
    constructor(prisma, generate, signedUrl) {
        this.prisma = prisma;
        this.generate = generate;
        this.signedUrl = signedUrl;
        this.logger = new common_1.Logger(TasksAdminService_1.name);
        /**
         * 任务列表 + 拥堵统计 + 筛选项。
         *
         * ⚠ 拥堵统计**刻意不受筛选条件影响**: 它的用途是回答"系统现在堵不堵",
         * 一旦跟随筛选, 运营筛了 status=failed 后 running 恒为 0, 拥堵信号
         * 反而在最需要的时候消失。筛选项同理从全量聚合, 避免前端硬编码清单过期。
         */
        /**
         * 筛选项缓存（60 秒）。
         *
         * capability / provider 的 groupBy 是全表聚合，与当前页筛选无关。
         * 每翻一页都扫两遍全表在 SQLite 上会随着任务量增长越来越慢，而筛选项
         * 的计数并不需要秒级准确 —— 一分钟足够。拥堵指标仍实时查询。
         */
        this.facetCache = null;
    }
    async list(query) {
        const page = (0, page_query_dto_1.buildPage)(query, [...SORTABLE], 'createdAt:desc');
        const where = this.listWhere(query);
        const [rows, total, facets, congestion] = await Promise.all([
            this.prisma.generationTask.findMany({
                where,
                skip: page.skip,
                take: page.take,
                orderBy: page.orderBy,
                /*
                 * owner/project 用于列表的「用户」「项目」两列; outputAsset 取缩略图。
                 * 三者都是必填外键或带唯一索引的 1:1, include 是单次 join 而非 N+1 ——
                 * 监控页默认 20 行, N+1 会打出 60 条查询, 列表明显变卡。
                 */
                include: {
                    owner: { select: { id: true, email: true } },
                    project: { select: { id: true, name: true } },
                    outputAsset: { select: { sourceUrl: true } },
                },
            }),
            this.prisma.generationTask.count({ where }),
            this.facets(),
            this.congestion(),
        ]);
        return {
            result: (0, page_query_dto_1.paginate)(rows.map((t) => {
                const def = (0, capability_registry_1.getCapability)(t.capability);
                return {
                    id: t.id,
                    capability: t.capability,
                    capabilityName: def?.name ?? t.capability,
                    status: t.status,
                    provider: normalizeProvider(t.provider),
                    errorCode: t.errorCode,
                    creditCost: t.creditCost,
                    retriedFromId: t.retriedFromId,
                    user: { id: t.owner.id, email: t.owner.email },
                    project: { id: t.project.id, name: t.project.name },
                    // 耗时 = updatedAt - createdAt (detailed-design §5.4)。
                    // 对 running 任务这个值会持续增长, 前端标注为"已进行"避免误读为已完成耗时。
                    durationMs: t.updatedAt.getTime() - t.createdAt.getTime(),
                    createdAt: t.createdAt,
                    updatedAt: t.updatedAt,
                    // 缩略图: 排障时一眼认出是哪个任务, 比读 id 快得多
                    thumbnailUrl: this.signedUrl.displayUrl(t.outputAsset?.sourceUrl),
                };
            }), total, page),
            congestion,
            capabilities: facets.capabilities,
            // 归一后再合并: 迁移前 pending 与 mock 会各占一行, 前端筛选器里出现两个「待执行」
            providers: facets.providers,
        };
    }
    /**
     * 能力 / 通道筛选项。
     *
     * 全表 groupBy 的结果按 60 秒缓存；迁移前的 `mock` 与 `pending`
     * 在这里归一合并，避免前端筛选器出现两个「待执行」。
     */
    async facets() {
        const cached = this.facetCache;
        if (cached && Date.now() - cached.at < TasksAdminService_1.FACET_TTL_MS) {
            return { capabilities: cached.capabilities, providers: cached.providers };
        }
        const [capGroups, providerGroups] = await Promise.all([
            this.prisma.generationTask.groupBy({ by: ['capability'], _count: { _all: true } }),
            this.prisma.generationTask.groupBy({ by: ['provider'], _count: { _all: true } }),
        ]);
        const facets = {
            capabilities: capGroups
                .map((g) => ({ capability: g.capability, count: g._count._all }))
                .sort((a, b) => b.count - a.count),
            providers: Object.entries(providerGroups.reduce((acc, g) => {
                const key = normalizeProvider(g.provider) ?? 'unknown';
                acc[key] = (acc[key] ?? 0) + g._count._all;
                return acc;
            }, {})).map(([provider, count]) => ({ provider, count })),
        };
        this.facetCache = { at: Date.now(), ...facets };
        return facets;
    }
    /**
     * 列表筛选条件。列表、导出与后续统计共用同一份构造器 ——
     * 分开写会出现「列表筛出 32 条、导出 400 条」的口径漂移。
     */
    listWhere(query) {
        const where = {};
        if (query.status)
            where['status'] = query.status;
        if (query.capability)
            where['capability'] = query.capability;
        // 筛「待执行」要同时命中迁移前后的两种写法, 否则旧数据一个也筛不出来
        if (query.provider) {
            where['provider'] =
                query.provider === 'pending'
                    ? { in: ['pending', LEGACY_PENDING_PROVIDER] }
                    : query.provider;
        }
        if (query.userId)
            where['ownerId'] = query.userId;
        if (query.projectId)
            where['projectId'] = query.projectId;
        if (query.from || query.to) {
            const createdAt = {};
            const from = parseDate(query.from);
            const to = parseDate(query.to);
            if (from)
                createdAt['gte'] = from;
            if (to)
                createdAt['lte'] = to;
            if (Object.keys(createdAt).length > 0)
                where['createdAt'] = createdAt;
        }
        return where;
    }
    /**
     * 导出任务 (CSV)。
     *
     * 上限 5000 行，与其它后台导出保持一致：导出是为了核对列表上的那批数据，
     * 不是导全库。超过上限时宁可在文件里少几行，也不把 SQLite 拖到无法响应。
     * 与列表共用 `listWhere`，筛什么就导出什么。
     */
    async exportCsv(query) {
        const rows = await this.prisma.generationTask.findMany({
            where: this.listWhere(query),
            orderBy: { createdAt: 'desc' },
            take: csv_1.CSV_EXPORT_MAX_ROWS,
            include: {
                owner: { select: { email: true } },
                project: { select: { name: true } },
            },
        });
        return (0, csv_1.toCsv)([
            { label: '任务 ID', value: (r) => r.id },
            { label: '能力', value: (r) => (0, capability_registry_1.getCapability)(r.capability)?.name ?? r.capability },
            { label: '状态', value: (r) => r.status },
            { label: '通道', value: (r) => normalizeProvider(r.provider) ?? '' },
            { label: '错误码', value: (r) => r.errorCode ?? '' },
            { label: '用户邮箱', value: (r) => r.owner.email },
            { label: '项目', value: (r) => r.project.name },
            { label: '消耗积分', value: (r) => r.creditCost },
            { label: '耗时(ms)', value: (r) => r.updatedAt.getTime() - r.createdAt.getTime() },
            { label: '创建时间', value: (r) => r.createdAt },
            { label: '更新时间', value: (r) => r.updatedAt },
        ], rows);
    }
    /**
     * 拥堵指标 (B-31)。
     *
     * 三个数字答三个不同的问题:
     *   queued       —— 提交了还没开始, 说明根本没被调度起来
     *   running      —— 正在跑, 超阈值说明通道吞吐跟不上提交速度
     *   failedLastHour —— 近 1 小时失败数, 失败率突增往往先于拥堵出现
     *
     * 独立方法而非在 list 里内联: 顶部告警条要高频刷新, 不该为它重算列表。
     */
    async congestion() {
        const [queued, running, failedLastHour] = await Promise.all([
            this.prisma.generationTask.count({ where: { status: 'queued' } }),
            this.prisma.generationTask.count({ where: { status: 'running' } }),
            this.prisma.generationTask.count({
                where: {
                    status: 'failed',
                    createdAt: { gte: new Date(Date.now() - RECENT_FAIL_WINDOW_MS) },
                },
            }),
        ]);
        return { queued, running, failedLastHour, runningThreshold: RUNNING_ALERT_THRESHOLD };
    }
    /**
     * 任务详情 (B-30)。
     *
     * 输入素材**按 inputAssetIds 原序**返回: 多图能力(爆款复刻/多图融合)
     * 依赖提交顺序语义, 打乱顺序会让运营对着详情页判断"哪张是商品图"时看错。
     */
    async detail(id) {
        const task = await this.prisma.generationTask.findUnique({
            where: { id },
            include: {
                owner: { select: { id: true, email: true } },
                project: { select: { id: true, name: true } },
                outputAsset: true,
            },
        });
        if (!task)
            throw new app_exception_1.AppError(40400, '任务不存在', 404);
        const inputIds = safeParse(task.inputAssetIds, []);
        const assets = await this.prisma.asset.findMany({
            where: { id: { in: inputIds } },
            select: { id: true, sourceUrl: true, width: true, height: true, kind: true },
        });
        const byId = new Map(assets.map((a) => [a.id, a]));
        const def = (0, capability_registry_1.getCapability)(task.capability);
        const output = task.outputAsset;
        return {
            id: task.id,
            capability: task.capability,
            capabilityName: def?.name ?? task.capability,
            status: task.status,
            provider: normalizeProvider(task.provider),
            errorCode: task.errorCode,
            creditCost: task.creditCost,
            retriedFromId: task.retriedFromId,
            user: { id: task.owner.id, email: task.owner.email },
            project: { id: task.project.id, name: task.project.name },
            durationMs: task.updatedAt.getTime() - task.createdAt.getTime(),
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            /*
             * 状态流转时间线 (detailed-design §5.3)。
             *
             * ⚠ 只有两个真实时间点: GenerationTask 未落 startedAt,
             * 「开始执行」的时刻**无法从库中还原**。这里不编造中间节点 ——
             * 补一个估算值会让运营误以为是系统记录的事实。
             * 若后续需要完整链路, 应在 processTask 入口写 startedAt 字段。
             */
            timeline: [
                { key: 'created', label: '创建', at: task.createdAt, done: true },
                {
                    key: 'finished',
                    label: task.status === 'succeeded'
                        ? '完成'
                        : task.status === 'failed'
                            ? '失败'
                            : task.status === 'cancelled'
                                ? '已终止'
                                : task.status === 'running'
                                    ? '执行中'
                                    : '等待中',
                    at: task.status === 'queued' || task.status === 'running' ? null : task.updatedAt,
                    done: task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled',
                },
            ],
            params: safeParse(task.params, {}),
            inputAssets: inputIds.map((assetId) => byId.get(assetId)).filter(Boolean),
            outputAsset: output
                ? {
                    id: output.id,
                    sourceUrl: this.signedUrl.displayUrl(output.sourceUrl),
                    width: output.width,
                    height: output.height,
                    format: output.format,
                    sizeBytes: output.sizeBytes,
                }
                : null,
        };
    }
    /**
     * 失败重试 (B-32)。
     *
     * 语义全部收在 `GenerateService.retryTask`：新建任务、复用模型快照、
     * `routeRun + 1`、不二次扣费。这里只补一条审计日志 —— 重试改变的是
     * 用户可见的任务状态，事后必须能回答「这个失败任务是谁重跑的」。
     */
    async retry(id) {
        const result = await this.generate.retryTask(id);
        this.logger.log(`任务 ${id} 重试为新任务 ${result.taskId}`);
        return result;
    }
    /**
     * 终止任务 (B-33)。
     *
     * 是否退款由 `TaskLifecycleService` 按 attempt 的派发状态决定：请求还没
     * 发出去的直接退款，已经发出去的任务置 `cancelled` 并把账单转人工核对 ——
     * 上游可能正在生成并计费，自动退款会让平台白付一次调用。
     */
    async cancel(id) {
        const result = await this.generate.cancelTask(id);
        this.logger.warn(`任务 ${id} 被后台终止，计费状态 ${result.billing}`);
        return result;
    }
    /**
     * 删除已结束任务。
     *
     * 复用用户端 `removeTask`：它会把父任务的子任务、产出素材记录与存储文件
     * 一并清理，但保留输入素材。后台额外限制排队中/执行中的任务不可直接删，
     * 必须先终止 —— 否则 worker 可能在删除后继续回写任务结果。
     */
    async remove(id) {
        const task = await this.prisma.generationTask.findUnique({
            where: { id },
            select: { ownerId: true },
        });
        if (!task)
            throw new app_exception_1.AppError(40400, '任务不存在', 404);
        const family = await this.prisma.generationTask.findMany({
            where: { OR: [{ id }, { parentTaskId: id }] },
            select: { status: true },
        });
        if (family.some((row) => row.status === 'queued' || row.status === 'running')) {
            throw new app_exception_1.AppError(40000, '排队中或执行中的任务不能直接删除，请先终止', 400);
        }
        const result = await this.generate.removeTask(task.ownerId, id);
        this.logger.warn(`任务 ${id} 被后台删除，产出素材已一并清理`);
        return result;
    }
    /**
     * 批量重试 / 终止 / 删除（B7）。
     *
     * 逐条复用单条实现，所以「仅失败任务可重试」「仅排队/执行中可终止」
     * 「仅已结束任务可删除」这些状态限制对批量同样生效 —— 批量失败往往是
     * 选了不同状态的任务，逐条原因正好把这件事讲清楚。
     */
    async batchAction(ids, action) {
        // 显式给 unknown: 三个动作的返回形状不同 (retry 回新任务 id, cancel 回状态,
        // delete 回删除结果), 让 TS 从第一个分支推断会把后续分支判成类型不符
        return (0, batch_1.runBatch)(ids, async (id) => {
            if (action === 'retry')
                return this.retry(id);
            if (action === 'cancel')
                return this.cancel(id);
            return this.remove(id);
        });
    }
    /** 已知能力 id 全集 (供前端筛选下拉, 与后端校验口径一致) */
    capabilityOptions() {
        return capability_registry_1.CAPABILITIES.map((def) => ({ id: def.id, name: def.name }));
    }
};
exports.TasksAdminService = TasksAdminService;
TasksAdminService.FACET_TTL_MS = 60_000;
exports.TasksAdminService = TasksAdminService = TasksAdminService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        generate_service_1.GenerateService,
        signed_url_service_1.SignedUrlService])
], TasksAdminService);
function parseDate(value) {
    if (!value)
        return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
}
/**
 * JSON 列的安全解析。
 *
 * 入库列是 String, 历史上可能存进非法 JSON (早期脚本直写)。解析失败
 * 返回兜底值而非抛错 —— 后台是排障入口, 在这里抛异常会让运营连任务
 * 详情都打不开, 反而看不到最关键的 errorCode。
 */
function safeParse(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
//# sourceMappingURL=tasks-admin.service.js.map