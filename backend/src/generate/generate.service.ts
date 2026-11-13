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

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { AppError } from '../common/app.exception';
import { SignedUrlService } from '../common/signed-url.service';
import { resolveUploadsDir } from '../config/env-files';
import { isBillingOrderReviewable } from '../model/billing/billing.service';
import { TaskAdmissionService } from '../model/tasks/task-admission.service';
import { TASK_ERROR, TaskLifecycleService } from '../model/tasks/task-lifecycle.service';
import { TaskWorkerService } from '../model/tasks/task-worker.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageBackend } from '../storage/storage.provider';
import { StorageService } from '../storage/storage.service';
import { CreateGenerationDto } from './dto/create-generation.dto';

/**
 * 任务读接口只取展示所需的列。
 *
 * 最关键的是**不读 `pendingResult`**：上游产出落盘失败时会把整份结果
 * （可能含内联 base64）暂存到该列，而任务详情每 1.2 秒被轮询一次。
 * 不带 select 时每次轮询都会把这坨大字段读出来再丢掉；`params` 等其余列
 * 则是序列化需要的，必须保留。
 */
const TASK_VIEW_SELECT = {
  id: true,
  projectId: true,
  ownerId: true,
  capability: true,
  status: true,
  inputAssetIds: true,
  params: true,
  parentTaskId: true,
  errorCode: true,
  modelKey: true,
  creditCost: true,
  createdAt: true,
  updatedAt: true,
  outputAssetId: true,
  outputAssetIds: true,
} as const;

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly signedUrl: SignedUrlService,
    private readonly admission: TaskAdmissionService,
    private readonly lifecycle: TaskLifecycleService,
    private readonly worker: TaskWorkerService,
  ) {}

  /** 建任务：准入 → 计价 → 预留 → 排队，随后由 worker 异步执行 */
  async createTask(ownerId: string, dto: CreateGenerationDto, idempotencyHeader?: string) {
    const result = await this.admission.admit({ ownerId, dto, idempotencyHeader });
    // 新任务立即调度一轮，省掉最多一个调度节拍的等待；幂等命中不重复调度
    if (!result.idempotentHit) this.worker.kick();
    return result;
  }

  /**
   * 投递任务（后台重试复用）。
   *
   * 公开而非让调用方自己触发：调度时机与「失败不冒泡」这两个语义必须
   * 收在一处，散落在两处迟早漂移。
   */
  enqueue(taskId: string): void {
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
   * 改造前创建的存量任务没有 `modelKey`，无法重新解析线路，明确拒绝
   * 而不是让它排队后立刻 42204 —— 那样运营会以为「重试过了」。
   */
  async retryTask(id: string) {
    const origin = await this.prisma.generationTask.findUnique({ where: { id } });
    if (!origin) throw new AppError(40400, '任务不存在', 404);
    if (origin.status !== 'failed') throw new AppError(40000, '仅失败任务可重试', 400);
    if (origin.errorCode === TASK_ERROR.uncertain) {
      // 上游可能已经受理并计费；直接重试会二次计费，必须先人工核对账单
      throw new AppError(40000, '结果不明的任务不能直接重试，请先核对上游账单', 400);
    }
    if (!origin.modelKey) {
      throw new AppError(40000, '存量任务没有模型快照，无法重试', 400);
    }

    const retryKey = `task-retry:${origin.id}`;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // 原任务读取与重试落库之间可能隔着后台软删项目；与正常建任务同一口径，
        // 在写事务内复核项目仍属于原用户且未删除，避免重试把任务塞回已删项目。
        const project = await tx.project.findFirst({
          where: {
            id: origin.projectId,
            ownerId: origin.ownerId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!project) throw new AppError(40001, '任务所属项目不存在或已删除', 403);

        // 兼容上线前已存在、但没有 retryKey 的重试任务；唯一约束负责拦截新数据
        // 的竞态，这次查询则保证旧数据不会在升级后再次派生重试任务。
        const existing = await tx.generationTask.findFirst({
          where: { retriedFromId: origin.id },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (existing) return { id: existing.id, reused: true };

        const created = await tx.generationTask.create({
          data: {
            projectId: origin.projectId,
            ownerId: origin.ownerId,
            capability: origin.capability,
            status: 'queued',
            stage: '排队中',
            inputAssetIds: origin.inputAssetIds,
            // 重试任务独立成一行：批次归属由 `parentTaskId` 表达，不能复用
            // 原批次的 batchId/batchIndex，否则结果页会出现两个同序号模块，
            // 删除原批次也带不走它。
            params: withoutBatchFields(origin.params),
            creditCost: 0,
            modelKey: origin.modelKey,
            channelModelId: origin.channelModelId,
            channelId: origin.channelId,
            // 新的一轮：attempt 编号从 1 重来，历史尝试留在原任务上可追溯
            routeRun: origin.routeRun + 1,
            retriedFromId: origin.id,
            retryKey,
            heartbeatAt: new Date(),
          },
        });
        return { id: created.id, reused: false };
      });

      this.worker.kick();
      if (result.reused) {
        this.logger.log(`任务 ${id} 已有重试任务 ${result.id}，复用本次结果`);
      } else {
        this.logger.log(`任务 ${id} 重试为新任务 ${result.id}`);
      }
      return { taskId: result.id, retriedFromId: origin.id };
    } catch (error) {
      // 先查再建仍挡不住两个后台请求同时通过检查，必须由数据库唯一约束兜底。
      // 冲突后返回先写入的重试任务，让重复点击得到与首次相同的结果。
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await this.prisma.generationTask.findUnique({
        where: { retryKey },
        select: { id: true },
      });
      if (!existing) throw error;

      this.worker.kick();
      this.logger.log(`任务 ${id} 已有重试任务 ${existing.id}，复用本次结果`);
      return { taskId: existing.id, retriedFromId: origin.id };
    }
  }

  /**
   * 后台终止任务。
   *
   * 已派发的任务不能自动退款（上游可能正在生成并计费）：任务置 `cancelled`，
   * 账单转 `uncertain` 等人工核对；未派发的直接退款。
   */
  async cancelTask(id: string) {
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
  async recoverOrphanTasks(): Promise<number> {
    return this.worker.recoverStaleTasks();
  }

  async getTask(ownerId: string, id: string) {
    const task = await this.prisma.generationTask.findFirst({
      where: { id, ownerId, project: { deletedAt: null } },
      select: TASK_VIEW_SELECT,
    });
    if (!task) {
      throw new AppError(40001, '任务不存在或无权限', 403);
    }

    const outputIds = orderedOutputIds(task.outputAssetId, task.outputAssetIds);
    const inputAssetIds = parseIdList(task.inputAssetIds);
    /*
     * 详情接口是前端轮询的最高频读路径（每个进行中的任务每 2-3 秒一次）。
     * 产出与输入互不依赖，必须并行取回；串行会把一次轮询变成两次串行往返。
     */
    const [outputs, inputRows] = await Promise.all([
      outputIds.length
        ? this.prisma.asset.findMany({ where: { id: { in: outputIds } } })
        : Promise.resolve([]),
      inputAssetIds.length
        ? this.prisma.asset.findMany({
            where: {
              id: { in: inputAssetIds },
              ownerId: task.ownerId,
              status: 'visible',
              project: { deletedAt: null },
            },
          })
        : Promise.resolve([]),
    ]);
    const outputById = new Map(outputs.map((asset) => [asset.id, asset]));
    const outputAssets = outputIds
      .map((assetId) => outputById.get(assetId))
      // 与列表口径一致：后台已下架的产出不能在详情接口借已知任务 id 绕过。
      .filter((asset): asset is NonNullable<typeof asset> => asset?.status === 'visible')
      .map((asset) => this.serializeOutputAsset(asset, task.ownerId));

    const inputById = new Map(inputRows.map((asset) => [asset.id, asset]));
    const inputAssets = inputAssetIds
      .map((assetId) => inputById.get(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => asset?.status === 'visible')
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
      errorCode: task.errorCode,
      // 作品页「重新生成」凭它沿用原模型分组；存量任务为 null
      modelKey: task.modelKey,
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
  async removeTask(ownerId: string, id: string) {
    const task = await this.prisma.generationTask.findUnique({ where: { id } });
    if (!task || task.ownerId !== ownerId) {
      throw new AppError(40001, '任务不存在或无权限', 403);
    }

    /*
     * 一次生成按模块拆成的多张图里, 其余任务由 `parentTaskId` 指向父任务。
     * 删除父任务必须整批删除 —— 只删父任务会留下一行缺原图、只剩几张模块图
     * 的孤立残片, 用户没法再选中整条记录删掉。删除某张子任务时只删它自己。
     */
    const batch = await this.prisma.generationTask.findMany({
      where: { ownerId, OR: [{ id: task.id }, { parentTaskId: task.id }] },
      select: {
        id: true,
        status: true,
        outputAssetId: true,
        outputAssetIds: true,
        pendingResult: true,
        mediaRecoveryError: true,
      },
    });
    const targets = batch.length > 0 ? batch : [task];

    /*
     * 删除只允许发生在「任务与账单都已落定」之后。
     *
     * 判据不是账单状态等不等于某个值，而是**删掉任务行之后这张账单还能不能被
     * 人工核对**（`isBillingOrderReviewable` 是唯一口径）：
     *   · `reserved` 预授权账单要求任务处于 failed/cancelled 才可核对；任务行
     *     不存在后它永远不可核对，积分会永久冻结 —— 必须拒绝；
     *   · 任务还挂着可交付产出（产出素材 / 待落盘结果 / 运行中的补交付）时必须
     *     拒绝：删任务等于抹掉「已交付」的证据，核对时会把出过的图当成可退款；
     *   · `uncertain` / 超时 `running` 且没有可交付产出时，账单自身就足以核对，
     *     任务行只是展示信息 —— 允许随任务一起删除。否则用户会永远删不掉一条
     *     自己早已失败/取消的记录（同批兄弟任务被判结果不明时尤其明显）。
     *
     * queued/running 任务一律拒绝：应先走终止流程，否则产出会在删除后才落盘。
     */
    const active = targets.filter((row) => row.status === 'queued' || row.status === 'running');
    if (active.length > 0) {
      throw new AppError(40901, '任务仍在排队或执行中，不能删除；请等待完成或先终止任务', 409);
    }
    const billingOrders = await this.prisma.billingOrder.findMany({
      where: { taskId: { in: targets.map((row) => row.id) } },
      select: { status: true, updatedAt: true, taskId: true },
    });
    const taskById = new Map(targets.map((row) => [row.id, row]));
    const blockedByBilling = billingOrders.some((order) => {
      if (order.status === 'reserved') return true;
      if (order.status === 'settled' || order.status === 'refunded') return false;
      const row = taskById.get(order.taskId);
      return !isBillingOrderReviewable(
        order,
        row
          ? {
              status: row.status,
              outputAssetId: row.outputAssetId,
              pendingResult: row.pendingResult,
              mediaRecoveryError: row.mediaRecoveryError,
            }
          : null,
      );
    });
    if (blockedByBilling) {
      throw new AppError(40901, '任务积分账单尚未结清或待人工核对，暂不能删除；请先处理账单', 409);
    }

    const outputIds = targets.flatMap((row) =>
      orderedOutputIds(row.outputAssetId, row.outputAssetIds),
    );
    const outputs = outputIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: outputIds }, ownerId } })
      : [];

    /*
     * 任务行与素材行必须同生共死：先删任务再删素材，中途失败会留下
     * 「任务已消失、素材还在」的孤儿记录；素材删除失败被吞掉时同样如此。
     * 放进一个事务，任何一步失败都整体回滚。
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.generationTask.deleteMany({ where: { id: { in: targets.map((row) => row.id) } } });
      if (outputs.length > 0) {
        await tx.asset.deleteMany({ where: { id: { in: outputs.map((asset) => asset.id) } } });
      }
    });

    const removedAsset = outputs.length > 0;

    /*
     * 文件按**写入时的后端**删除，失败不阻塞（库已删，留文件无害）。
     * 必须走 StorageService 而不是拼本地路径：素材可能落在 oss/minio，
     * 那里没有 /uploads/ 前缀，按本地路径推导只会静默漏删。
     */
    for (const out of outputs) {
      if (out.storageKey) {
        const backend = (out.storageBackend as StorageBackend) ?? 'local';
        await this.storage
          .get(backend)
          ?.delete(out.storageKey)
          .catch(() => undefined);
      } else if (out.sourceUrl?.startsWith('/uploads/')) {
        const parts = out.sourceUrl
          .replace(/^\/uploads\//, '')
          .split('/')
          .filter(Boolean);
        if (parts.length === 2 && !parts.some((p) => p.includes('..'))) {
          await unlink(join(resolveUploadsDir(), parts[0], parts[1])).catch(() => undefined);
        }
      }
    }

    return { id, removedAsset };
  }

  async listTasks(ownerId: string, projectId?: string) {
    const where: Prisma.GenerationTaskWhereInput = {
      ownerId,
      project: { deletedAt: null },
    };
    if (projectId) where.projectId = projectId;

    // 产出素材由 serializeTasks 按 id 批量取回；再 include 关系等于把同一批
    // 素材先 JOIN 一次又丢掉，纯属重复读。
    const tasks = await this.prisma.generationTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: TASK_VIEW_SELECT,
    });
    return this.serializeTasks(tasks);
  }

  /**
   * 分页任务列表。
   *
   * `/tasks` 旧接口保留全量数组（修图历史等小范围使用）；作品页和结果栏
   * 改用这个分页接口，避免用户任务积累到几千条后每次进页面都拉全量。
   */
  async listTasksPage(
    ownerId: string,
    params: {
      projectId?: string;
      capability?: string;
      excludeFailed?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const take = Math.min(Math.max(Number(params.limit) || 50, 1), 100);
    const skip = Math.max(Number(params.offset) || 0, 0);
    const where: Prisma.GenerationTaskWhereInput = {
      ownerId,
      project: { deletedAt: null },
    };
    if (params.projectId) where.projectId = params.projectId;
    if (params.capability) where.capability = params.capability;
    // 批次失败时，父任务为 failed、尚未完成的子任务会被取消为 cancelled。
    // 两者都是终态且没有可展示产出，不能把 cancelled 误当成“生成中”留在作品页。
    if (params.excludeFailed) where.status = { notIn: ['failed', 'cancelled'] };
    const [tasks, total] = await Promise.all([
      this.prisma.generationTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: TASK_VIEW_SELECT,
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
  private async serializeTasks(tasks: any[]) {
    const allOutputIds = Array.from(
      new Set(tasks.flatMap((task) => orderedOutputIds(task.outputAssetId, task.outputAssetIds))),
    );
    // 输入图一次性取回：详情图结果行要按批次展示「原图」，逐任务查会放大到 N 次往返
    const inputIdsByTask = new Map(tasks.map((t) => [t.id, parseIdList(t.inputAssetIds)]));
    const allInputIds = Array.from(new Set([...inputIdsByTask.values()].flat()));
    const taskOwnerIds = Array.from(new Set(tasks.map((t) => t.ownerId)));
    // 产出与输入互不依赖，并行取回；列表页只多一条 SQL 的往返，而不是串行两轮。
    const [outputRows, inputRows] = await Promise.all([
      allOutputIds.length
        ? this.prisma.asset.findMany({ where: { id: { in: allOutputIds } } })
        : Promise.resolve([]),
      allInputIds.length
        ? this.prisma.asset.findMany({
            where: {
              id: { in: allInputIds },
              ownerId: { in: taskOwnerIds },
              status: 'visible',
              project: { deletedAt: null },
            },
          })
        : Promise.resolve([]),
    ]);
    const outputById = new Map(outputRows.map((asset) => [asset.id, asset]));
    const inputById = new Map(inputRows.map((asset) => [asset.id, asset]));

    return tasks.map((t) => {
      const inputAssetIds = inputIdsByTask.get(t.id) ?? [];
      const inputAssets = inputAssetIds
        .map((assetId) => inputById.get(assetId))
        .filter((asset): asset is NonNullable<typeof asset> => asset?.status === 'visible')
        .map((asset) => this.serializeOutputAsset(asset, t.ownerId));
      /*
       * 产出素材被后台下架（status='hidden'）的不再下发。没有产出的任务
       * （失败 / 进行中）照常保留 —— 它们不是「被下架」，而是本来就没有图。
       */
      const outputAssets = orderedOutputIds(t.outputAssetId, t.outputAssetIds)
        .map((assetId) => outputById.get(assetId))
        .filter((asset): asset is NonNullable<typeof asset> => asset?.status === 'visible')
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
        errorCode: t.errorCode,
        modelKey: t.modelKey,
        creditCost: t.creditCost,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        outputAsset: outputAssets[0] ?? null,
        outputAssets,
      };
    });
  }

  /** 把任务里的素材记录转成前端任务接口的稳定形状。 */
  private serializeOutputAsset(
    output: {
      id: string;
      sourceUrl: string;
      aigcMeta: string;
      capability: string | null;
      width: number | null;
      height: number | null;
      format: string;
      durationMs: number | null;
    },
    ownerId: string,
  ) {
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
}

function parseAigcMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 任务里 JSON 数组字符串 → 去空的 id 列表（`inputAssetIds` 用） */
function parseIdList(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 产出素材 id 列表：首项优先，顺次去重（历史任务只有 outputAssetId） */
function orderedOutputIds(primaryId: string | null, idsJson: string | null | undefined): string[] {
  const ids: string[] = [];
  if (primaryId) ids.push(primaryId);
  try {
    const parsed = JSON.parse(idsJson || '[]');
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const id = String(item ?? '').trim();
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
  } catch {
    // 历史脏数据：只剩首项可用
  }
  return ids;
}

/**
 * 后台重试：参数原样复制，但去掉批次字段。
 *
 * 重试任务没有 `parentTaskId`，若继续携带原批次的 `batchId/batchIndex`，
 * 结果页会按 batchId 把它并入原批次，出现重复序号；删除原父任务时也带不走它。
 * 保留 `section/sectionPrompt/sectionLabel`，确保重试的仍是同一个模块。
 */
function withoutBatchFields(raw: string): string {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
    const params = parsed as Record<string, unknown>;
    delete params.batchId;
    delete params.batchIndex;
    delete params.batchSize;
    return JSON.stringify(params);
  } catch {
    return raw;
  }
}
