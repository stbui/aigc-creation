import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateService } from '../generate/generate.service';
import { AppError } from '../common/app.exception';
import { runBatch } from '../common/batch';
import { CSV_EXPORT_MAX_ROWS, toCsv } from '../common/csv';
import { getCapability } from '../capabilities/capability.registry';
import { CAPABILITY_IDS } from '../providers/channel-config.defs';
import { buildPage, paginate, type PageResult } from './dto/page-query.dto';
import type { TaskListQueryDto } from './dto/task.dto';
import { SignedUrlService } from '../common/signed-url.service';

/** 可排序列白名单: status/createdAt/updatedAt 都是 SQLite 上的真实列 */
const SORTABLE = ['createdAt', 'updatedAt', 'status', 'capability'] as const;

/**
 * provider 的历史初始值 `mock` 与现在的 `pending` 同义 (2026-10-22 更名)。
 *
 * 迁移脚本 `db:migrate:provider` 会把存量行改写, 但**读取侧仍要归一**:
 * 迁移可能还没跑, 且用户可能拿旧库连新代码。筛选要覆盖两种写法,
 * 展示与分组只出 `pending` —— 否则后台「待执行」那一档在迁移前会是空的。
 */
const LEGACY_PENDING_PROVIDER = 'mock';
function normalizeProvider(value: string | null | undefined): string | null {
  if (!value) return null;
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
@Injectable()
export class TasksAdminService {
  private readonly logger = new Logger(TasksAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generate: GenerateService,
    private readonly signedUrl: SignedUrlService,
  ) {}

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
  private facetCache: {
    at: number;
    capabilities: Array<{ capability: string; count: number }>;
    providers: Array<{ provider: string; count: number }>;
  } | null = null;
  private static readonly FACET_TTL_MS = 60_000;

  async list(query: TaskListQueryDto): Promise<{
    result: PageResult<unknown>;
    congestion: {
      pending: number;
      running: number;
      failedLastHour: number;
      runningThreshold: number;
    };
    capabilities: Array<{ capability: string; count: number }>;
    providers: Array<{ provider: string; count: number }>;
  }> {
    const page = buildPage(query, [...SORTABLE], 'createdAt:desc');
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
      result: paginate(
        rows.map((t) => {
          const def = getCapability(t.capability);
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
        }),
        total,
        page,
      ),
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
  private async facets(): Promise<{
    capabilities: Array<{ capability: string; count: number }>;
    providers: Array<{ provider: string; count: number }>;
  }> {
    const cached = this.facetCache;
    if (cached && Date.now() - cached.at < TasksAdminService.FACET_TTL_MS) {
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
      providers: Object.entries(
        providerGroups.reduce<Record<string, number>>((acc, g) => {
          const key = normalizeProvider(g.provider) ?? 'unknown';
          acc[key] = (acc[key] ?? 0) + g._count._all;
          return acc;
        }, {}),
      ).map(([provider, count]) => ({ provider, count })),
    };
    this.facetCache = { at: Date.now(), ...facets };
    return facets;
  }

  /**
   * 列表筛选条件。列表、导出与后续统计共用同一份构造器 ——
   * 分开写会出现「列表筛出 32 条、导出 400 条」的口径漂移。
   */
  private listWhere(query: TaskListQueryDto): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.capability) where['capability'] = query.capability;
    // 筛「待执行」要同时命中迁移前后的两种写法, 否则旧数据一个也筛不出来
    if (query.provider) {
      where['provider'] =
        query.provider === 'pending'
          ? { in: ['pending', LEGACY_PENDING_PROVIDER] }
          : query.provider;
    }
    if (query.userId) where['ownerId'] = query.userId;
    if (query.projectId) where['projectId'] = query.projectId;
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      const from = parseDate(query.from);
      const to = parseDate(query.to);
      if (from) createdAt['gte'] = from;
      if (to) createdAt['lte'] = to;
      if (Object.keys(createdAt).length > 0) where['createdAt'] = createdAt;
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
  async exportCsv(query: TaskListQueryDto): Promise<string> {
    const rows = await this.prisma.generationTask.findMany({
      where: this.listWhere(query),
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_MAX_ROWS,
      include: {
        owner: { select: { email: true } },
        project: { select: { name: true } },
      },
    });

    return toCsv(
      [
        { label: '任务 ID', value: (r) => r.id },
        { label: '能力', value: (r) => getCapability(r.capability)?.name ?? r.capability },
        { label: '状态', value: (r) => r.status },
        { label: '通道', value: (r) => normalizeProvider(r.provider) ?? '' },
        { label: '错误码', value: (r) => r.errorCode ?? '' },
        { label: '用户邮箱', value: (r) => r.owner.email },
        { label: '项目', value: (r) => r.project.name },
        { label: '消耗积分', value: (r) => r.creditCost },
        { label: '耗时(ms)', value: (r) => r.updatedAt.getTime() - r.createdAt.getTime() },
        { label: '创建时间', value: (r) => r.createdAt },
        { label: '更新时间', value: (r) => r.updatedAt },
      ],
      rows,
    );
  }

  /**
   * 拥堵指标 (B-31)。
   *
   * 三个数字答三个不同的问题:
   *   pending      —— 提交了还没开始, 说明根本没被调度起来
   *   running      —— 正在跑, 超阈值说明通道吞吐跟不上提交速度
   *   failedLastHour —— 近 1 小时失败数, 失败率突增往往先于拥堵出现
   *
   * 独立方法而非在 list 里内联: 顶部告警条要高频刷新, 不该为它重算列表。
   */
  async congestion() {
    const [pending, running, failedLastHour] = await Promise.all([
      this.prisma.generationTask.count({ where: { status: 'pending' } }),
      this.prisma.generationTask.count({ where: { status: 'running' } }),
      this.prisma.generationTask.count({
        where: {
          status: 'failed',
          createdAt: { gte: new Date(Date.now() - RECENT_FAIL_WINDOW_MS) },
        },
      }),
    ]);
    return { pending, running, failedLastHour, runningThreshold: RUNNING_ALERT_THRESHOLD };
  }

  /**
   * 任务详情 (B-30)。
   *
   * 输入素材**按 inputAssetIds 原序**返回: 多图能力(爆款复刻/多图融合)
   * 依赖提交顺序语义, 打乱顺序会让运营对着详情页判断"哪张是商品图"时看错。
   */
  async detail(id: string) {
    const task = await this.prisma.generationTask.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true } },
        project: { select: { id: true, name: true } },
        outputAsset: true,
      },
    });
    if (!task) throw new AppError(40400, '任务不存在', 404);

    const inputIds = safeParse<string[]>(task.inputAssetIds, []);
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: inputIds } },
      select: { id: true, sourceUrl: true, width: true, height: true, kind: true },
    });
    const byId = new Map(assets.map((a) => [a.id, a]));

    const def = getCapability(task.capability);
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
          label:
            task.status === 'succeeded'
              ? '完成'
              : task.status === 'failed'
                ? '失败'
                : task.status === 'running'
                  ? '执行中'
                  : '等待中',
          at: task.status === 'pending' || task.status === 'running' ? null : task.updatedAt,
          done: task.status === 'succeeded' || task.status === 'failed',
        },
      ],
      params: safeParse<Record<string, unknown>>(task.params, {}),
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
   * **新建任务而非原地复活**: outputAssetId 有 @unique 的 1:1 约束,
   * 原地复活会让新产出图与旧产出图抢同一个唯一键, 必然冲突。
   *
   * ⚠ 重试**不二次扣费**, 因此新任务的 `creditCost` 必须记 0。
   *
   * 原任务失败时已按快照退款, 若这里沿用原值, 新任务再失败会触发
   * `refundForFailure` 第二次退款 —— 用户没有为这次重试付过钱, 等于白送。
   * `retriedFromId` 保留可追溯性; 后台展示原价请查原任务。
   */
  async retry(id: string) {
    const origin = await this.prisma.generationTask.findUnique({ where: { id } });
    if (!origin) throw new AppError(40400, '任务不存在', 404);
    if (origin.status !== 'failed') {
      throw new AppError(40000, '仅失败任务可重试', 400);
    }

    const next = await this.prisma.generationTask.create({
      data: {
        projectId: origin.projectId,
        ownerId: origin.ownerId,
        capability: origin.capability,
        status: 'running',
        inputAssetIds: origin.inputAssetIds,
        params: origin.params,
        // 与 generate.service.createTask 一致: 建任务时写 pending,
        // 跑完后由 processTask 改写成实际通道
        provider: 'pending',
        creditCost: 0,
        retriedFromId: origin.id,
      },
    });

    this.generate.enqueue(next.id);
    this.logger.log(`任务 ${id} 重试为新任务 ${next.id}`);

    return { taskId: next.id, retriedFromId: origin.id };
  }

  /**
   * 终止任务 (B-33)。
   *
   * ⚠ **本方法只改数据库状态, 不中断正在跑的进程**。彻底解决需要给
   * processTask 加 AbortSignal —— 本期通过 processTask 的落库前状态检查
   * (见 generate.service) 兜底: 已被终止的任务不会再写入产出图,
   * 但已经发出的模型调用仍会跑完并计费。
   *
   * 限制可终止状态: 已完成的任务再改成 failed 会让成功率统计与产出对不上。
   */
  async cancel(id: string) {
    const task = await this.prisma.generationTask.findUnique({ where: { id } });
    if (!task) throw new AppError(40400, '任务不存在', 404);
    if (task.status !== 'pending' && task.status !== 'running') {
      throw new AppError(40000, '仅等待中或执行中的任务可终止', 400);
    }

    const updated = await this.prisma.generationTask.update({
      where: { id },
      data: { status: 'failed', errorCode: 'cancelled_by_admin', updatedAt: new Date() },
    });

    this.logger.warn(`任务 ${id} 被后台终止 (原状态 ${task.status})`);
    return { id, status: updated.status, errorCode: updated.errorCode };
  }

  /**
   * 批量重试 / 终止（B7）。
   *
   * 逐条复用单条实现，所以「仅失败任务可重试」「仅排队/执行中可终止」
   * 这些状态限制对批量同样生效 —— 批量失败往往是选了不同状态的任务，
   * 逐条原因正好把这件事讲清楚。
   */
  async batchAction(ids: string[], action: 'retry' | 'cancel') {
    // 显式给 unknown: 两个动作的返回形状不同 (retry 回新任务 id, cancel 回状态),
    // 让 TS 从第一个分支推断会把 cancel 判成类型不符
    return runBatch<unknown>(ids, (id) => (action === 'retry' ? this.retry(id) : this.cancel(id)));
  }

  /** 已知能力 id 全集 (供前端筛选下拉, 与后端校验口径一致) */
  capabilityOptions() {
    return CAPABILITY_IDS.map((id) => {
      const def = getCapability(id);
      return { id, name: def?.name ?? id };
    });
  }
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
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
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
