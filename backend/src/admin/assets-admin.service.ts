import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { runBatch } from '../common/batch';
import { toCsv } from '../common/csv';
import { StorageService } from '../storage/storage.service';
import { SignedUrlService } from '../common/signed-url.service';
import { buildPage, paginate, type PageResult } from './dto/page-query.dto';
import type { AssetListQueryDto, ProjectListQueryDto } from './dto/asset.dto';
import type { StorageBackend } from '../storage/storage.provider';

/** 素材管理 (admin-prd.md §3.4 B-21~B-27) */
@Injectable()
export class AdminAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  // ── 项目 (B-21/B-22) ────────────────────────────────────────────────

  /** 项目列表: 名称、所属用户、素材数、任务数、创建时间 */
  async listProjects(query: ProjectListQueryDto) {
    const page = buildPage(query, ['createdAt', 'name'], 'createdAt:desc');

    const where: Record<string, unknown> = {};
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

  /**
   * 删除项目 (B-22): 连带素材与任务。
   *
   * 顺序: 先删文件 → 再删数据库记录。
   * 与素材删除相反 —— 这里先删文件是故意的: 记录删了就查不到 key,
   * 文件就成了无法回收的孤儿, 永久占磁盘。
   */
  async removeProject(id: string, hard: boolean) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        assets: { select: { id: true, storageKey: true, storageBackend: true } },
        tasks: { select: { id: true } },
      },
    });
    if (!project) throw new AppError(40400, '项目不存在', 404);

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

    // 1) 先删文件
    for (const a of project.assets) {
      if (!a.storageKey) continue;
      const p = this.storage.get((a.storageBackend as StorageBackend) ?? 'local');
      await p?.delete(a.storageKey);
    }

    // 2) 再删记录 (事务保证原子)
    await this.prisma.$transaction(async (tx) => {
      await tx.generationTask.deleteMany({ where: { projectId: id } });
      if (hard) {
        await tx.asset.deleteMany({ where: { projectId: id } });
      } else {
        // 软删: 素材置下架而非删除 —— 记录保留便于追溯项目被删时素材去了哪
        await tx.asset.updateMany({
          where: { projectId: id },
          data: { status: 'hidden' },
        });
      }
      await tx.project.delete({ where: { id } });
    });

    return { id, hard, impact };
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
      take: 5000,
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

  /** 批量下架/恢复 */
  async setStatusMany(ids: string[], status: 'visible' | 'hidden') {
    if (ids.length === 0) throw new AppError(40001, '未选择素材', 400);
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
  async remove(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, storageKey: true, storageBackend: true },
    });
    if (!asset) throw new AppError(40400, '素材不存在', 404);

    const producedTasks = await this.prisma.generationTask.findMany({
      where: { outputAssetId: id },
      select: { id: true },
    });

    // 先删文件: 记录删了就查不到 key, 文件会成永久孤儿
    if (asset.storageKey) {
      const p = this.storage.get((asset.storageBackend as StorageBackend) ?? 'local');
      await p?.delete(asset.storageKey);
    }

    await this.prisma.$transaction(async (tx) => {
      if (producedTasks.length) {
        await tx.generationTask.deleteMany({ where: { id: { in: producedTasks.map((t) => t.id) } } });
      }
      await tx.asset.delete({ where: { id } });
    });

    return { id, removedTasks: producedTasks.length };
  }

  /** 删除前的连带影响预览, 供确认弹窗量化展示 */
  async impact(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new AppError(40400, '素材不存在', 404);
    const tasks = await this.prisma.generationTask.count({ where: { outputAssetId: id } });
    return { sizeBytes: asset.sizeBytes, tasks, storageBackend: asset.storageBackend };
  }
}

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}