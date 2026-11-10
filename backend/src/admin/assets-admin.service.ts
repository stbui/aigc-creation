import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { runBatch } from '../common/batch';
import { CSV_EXPORT_MAX_ROWS, toCsv } from '../common/csv';
import { StorageService } from '../storage/storage.service';
import { SignedUrlService } from '../common/signed-url.service';
import { buildPage, paginate, type PageResult } from './dto/page-query.dto';
import type { AssetListQueryDto, ProjectListQueryDto } from './dto/asset.dto';
import type { StorageBackend } from '../storage/storage.provider';
import {
  detachAssetFromTasks,
  orderedOutputIds,
  taskOutputReferenceWhere,
} from '../assets/task-output-links';

/** 素材管理 (admin-prd.md §3.4 B-21~B-27) */
@Injectable()
export class AdminAssetsService {
  private readonly logger = new Logger(AdminAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  // ── 项目 (B-21/B-22) ────────────────────────────────────────────────

  /** 项目列表: 名称、所属用户、素材数、任务数、创建时间 */
  async listProjects(query: ProjectListQueryDto) {
    const page = buildPage(query, ['createdAt', 'name'], 'createdAt:desc');

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.keyword) where.name = { contains: query.keyword };
    if (query.ownerId) where.ownerId = query.ownerId;

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

    return paginate(
      items.map((p) => ({
        id: p.id,
        name: p.name,
        ownerId: p.ownerId,
        ownerEmail: p.owner.email,
        ownerName: p.owner.name,
        assetCount: p._count.assets,
        taskCount: p._count.tasks,
        createdAt: p.createdAt,
      })),
      total,
      page,
    );
  }

  /** 后台新建项目：归属用户必须存在且处于正常状态。 */
  async createProject(name: string, ownerId: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, status: true },
    });
    if (!owner || owner.status !== 'active') {
      throw new AppError(40001, '所属用户不存在或不可用', 400);
    }
    return this.prisma.project.create({
      data: { name: name.trim(), ownerId },
    });
  }

  /** 后台编辑项目名。归属用户不在这里变更，避免与素材 ownerId 脱节。 */
  async updateProject(id: string, name: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new AppError(40400, '项目不存在', 404);
    return this.prisma.project.update({
      where: { id },
      data: { name: name.trim() },
    });
  }

  /**
   * 删除项目 (B-22): 软删除，不物理删除素材、任务或文件。
   *
   * 项目下仍有素材时，必须用 `moveAssetsTo` 指定同一用户的另一个未删除项目；
   * 素材迁移只改 Asset.projectId，GenerationTask.projectId 保留历史归属。
   * 重复删除按幂等成功处理，不覆盖首次删除时间。
   */
  async removeProject(id: string, moveAssetsTo?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        deletedAt: true,
        _count: { select: { assets: true, tasks: true } },
      },
    });
    if (!project) throw new AppError(40400, '项目不存在', 404);

    // 已删除项目直接返回首次删除结果，重复操作不覆盖时间。
    if (project.deletedAt) {
      return {
        id,
        hard: false,
        deprecatedHard: true,
        deletedAt: project.deletedAt,
        movedAssets: 0,
        retained: { assets: project._count.assets, tasks: project._count.tasks },
      };
    }

    const targetId = moveAssetsTo?.trim() || undefined;
    if (project._count.assets > 0 && !targetId) {
      throw new AppError(40901, '项目下还有素材，请选择迁移目标项目', 409);
    }
    if (targetId === id) {
      throw new AppError(40001, '迁移目标不能是当前项目', 400);
    }

    const deletedAt = new Date();
    let movedAssets = 0;
    await this.prisma.$transaction(async (tx) => {
      if (project._count.assets > 0 && targetId) {
        const target = await tx.project.findFirst({
          where: { id: targetId, ownerId: project.ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!target) {
          throw new AppError(40001, '迁移目标项目不存在或不可用', 400);
        }
        const moved = await tx.asset.updateMany({
          where: { projectId: id, ownerId: project.ownerId },
          data: { projectId: targetId },
        });
        movedAssets = moved.count;
      }

      await tx.project.update({
        where: { id },
        data: { deletedAt },
      });
    });

    return {
      id,
      hard: false,
      deprecatedHard: true,
      deletedAt,
      movedAssets,
      retained: {
        assets: Math.max(0, project._count.assets - movedAssets),
        tasks: project._count.tasks,
      },
    };
  }

  // ── 素材 (B-23~B-27) ───────────────────────────────────────────────

  /**
   * 素材列表 (B-23/B-24)。
   *
   * 与用户端不同: **不过滤 status** —— 管理端必须能看到已下架素材,
   * 否则运营找不到"我下架过的东西在哪"。
   */
  async list(query: AssetListQueryDto): Promise<PageResult<unknown>> {
    const page = buildPage(query, ['createdAt', 'sizeBytes'], 'createdAt:desc');
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

    return paginate(
      items.map((a) => ({
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
      })),
      total,
      page,
    );
  }

  /**
   * 导出素材 (CSV)。
   *
   * sourceUrl 用 displayUrl（签名开启时带签）—— 导出的表格里如果只有
   * 裸路径，打开就是 403，运营会以为"素材丢了"。
   */
  async exportCsv(query: AssetListQueryDto): Promise<string> {
    const rows = await this.prisma.asset.findMany({
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
      ],
      rows,
    );
  }

  /**
   * 批量下架 / 恢复 / 删除（B7）。
   *
   * 与 `setStatusMany` 的区别：后者用一条 `updateMany`，快但只有总数、
   * 说不出哪条没成（比如 id 已不存在）；本方法逐条给出结果与原因。
   * 批量删除尤其需要逐条反馈 —— 用户要知道具体哪些删掉了。
   */
  async batchAction(ids: string[], action: 'hide' | 'show' | 'delete') {
    return runBatch(ids, async (id) => {
      if (action === 'delete') return this.remove(id);
      return this.setStatus(id, action === 'hide' ? 'hidden' : 'visible');
    });
  }

  /** 列表 / 导出共用的素材筛选条件 */
  private listWhere(query: AssetListQueryDto): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (query.keyword) {
      where['OR'] = [{ id: { contains: query.keyword } }, { capability: { contains: query.keyword } }];
    }
    if (query.kind) where.kind = query.kind;
    if (query.capability) where.capability = query.capability;
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.backend) where.storageBackend = query.backend;

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt['gte'] = query.from;
      if (query.to) createdAt['lte'] = query.to;
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
        const m: Record<string, number> = {};
        for (const r of byStatus) m[r.status] = r._count._all;
        return m;
      })(),
      byBackend: (() => {
        const m: Record<string, number> = {};
        for (const r of byBackend) m[r.storageBackend] = r._count._all;
        return m;
      })(),
      byKind: (() => {
        const m: Record<string, number> = {};
        for (const r of byKind) m[r.kind] = r._count._all;
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
  async setStatus(id: string, status: 'visible' | 'hidden') {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new AppError(40400, '素材不存在', 404);
    await this.prisma.asset.update({ where: { id }, data: { status } });
    return { id, status };
  }

  /** 兼容旧入口的批量下架/恢复；逐条返回结果。 */
  async setStatusMany(ids: string[], status: 'visible' | 'hidden') {
    const summary = await runBatch(ids, (id) => this.setStatus(id, status));
    return { ...summary, count: summary.succeeded, status };
  }

  /**
   * 删除素材 (B-27): 连带磁盘文件与产出任务。
   *
   * 文件删除按**写入时的后端**, 不能用当前默认后端 —— 否则切换过
   * STORAGE_BACKEND 后老素材的云端文件永远删不掉。
   */
  async remove(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, storageKey: true, storageBackend: true },
    });
    if (!asset) throw new AppError(40400, '素材不存在', 404);

    const removedTasks = await this.prisma.$transaction(async (tx) => {
      const removedTasks = await detachAssetFromTasks(tx, id);
      await tx.asset.delete({ where: { id } });
      return removedTasks;
    });

    // 数据库提交后再清文件；失败不回滚，避免记录还在但文件已丢
    await this.deleteStoredAssets([asset]);

    return { id, removedTasks };
  }

  /** 删除前的连带影响预览, 供确认弹窗量化展示 */
  async impact(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new AppError(40400, '素材不存在', 404);
    const linkedTasks = await this.prisma.generationTask.findMany({
      where: taskOutputReferenceWhere(id),
      select: { id: true, outputAssetId: true, outputAssetIds: true },
    });
    const tasks = linkedTasks.filter((task) =>
      orderedOutputIds(task.outputAssetId, task.outputAssetIds).includes(id),
    ).length;
    return { sizeBytes: asset.sizeBytes, tasks, storageBackend: asset.storageBackend };
  }

  /** 文件删除是提交后的 best-effort；失败留孤儿文件，不制造坏记录。 */
  private async deleteStoredAssets(
    assets: Array<{ storageKey: string | null; storageBackend: string }>,
  ): Promise<void> {
    for (const asset of assets) {
      if (!asset.storageKey) continue;
      try {
        const provider = this.storage.get(
          (asset.storageBackend as StorageBackend) ?? 'local',
        );
        if (!provider) {
          this.logger.warn(
            `素材文件未删除：存储后端 ${asset.storageBackend} 未启用 (${asset.storageKey})`,
          );
          continue;
        }
        await provider.delete(asset.storageKey);
      } catch (error) {
        this.logger.warn(
          `素材文件删除失败，数据库记录已删除: ${asset.storageKey} — ${(error as Error).message}`,
        );
      }
    }
  }
}

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
