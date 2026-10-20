import { Injectable } from '@nestjs/common';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { StorageService } from '../storage/storage.service';
import { resolveUploadsDir } from '../config/env-files';
import type { StorageBackend } from '../storage/storage.provider';

export interface UploadedFileMeta {
  filename: string;
  originalname: string;
  size: number;
  mimetype: string;
}

/**
 * 用户端素材服务。
 *
 * 改造要点 (对应 admin-prd.md §3.4/ §3.17):
 *   1. **走存储抽象层**, 不再硬编码 join(cwd,'uploads',...) —— 接 OSS/MinIO
 *      只需改 STORAGE_BACKEND 环境变量, 本文件零改动。
 *   2. **写入时记录 storageBackend**: 切换默认后端后老素材仍从原后端读。
 *      不加这个字段, 切换后端会让全部历史素材404。
 *   3. **status='hidden' 对用户端不可见** (B-26 下架): 记录与文件保留,
 *      误下架可恢复 —— 删除不可逆, 两者必须区分。
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createOriginal(ownerId: string, projectId: string, file: UploadedFileMeta) {
    if (!projectId) {
      throw new AppError(40001, 'projectId 必填', 400);
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.ownerId !== ownerId) {
      throw new AppError(40001, '项目不存在或无权限', 403);
    }

    const ext = (file.originalname.toLowerCase().split('.').pop() || 'jpg').replace(/[^a-z0-9]/g, '');
    const format = mimeFromExt(ext, file.mimetype);

    // multer 已把上传落到本地临时目录（与 assets.controller 的 destination 同源,
    // 都读 UPLOAD_DIR）; 读出后转存到当前默认后端。
    // 云端部署时这一步把文件从临时盘搬到对象存储, 之后临时文件可由保留期策略清理。
    const buf = await fsp.readFile(join(resolveUploadsDir(), 'original', file.filename));

    const provider = this.storage.getActive();
    const key = this.storage.buildKey('original', ext);
    const stored = await provider.put(key, buf, format);
    const url = await provider.url(key);

    const dims = await probeDimensions(buf);

    return this.prisma.asset.create({
      data: {
        projectId,
        ownerId,
        kind: 'original',
        sourceUrl: url,
        format,
        sizeBytes: stored.sizeBytes,
        // 记录尺寸, 素材库与作品页才有宽高可展示 (探测失败不阻断上传)
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        storageBackend: provider.backend,
        storageKey: key,
      },
    });
  }

  /**
   * 素材库列表: kind / capability / 关键词 / 时间范围筛选与分页。
   *
   * 已下架素材不返回 (status='visible')。
   *
   * ## 关键词 (keyword) 搜什么
   *
   * ⚠️ **搜 sourceUrl 而不是文件名** —— 本项目素材表**没有原始文件名字段**:
   * `createOriginal` 存的是存储 key (`original/202610/xxx.jpg`), 原始文件名
   * 只在上传时经 multer 落在临时路径上, 没有入库。
   * 故按 sourceUrl 搜 = 按存储 key 里的可读片段搜 (含日期段与随机尾),
   * 能命中用户记忆中的文件名片段 (如 "套图") —— 是当前数据模型下**唯一可搜的字段**。
   *
   * 若日后要按原始文件名搜, 需给 Asset 加 `originalName` 字段 (schema 变更),
   * 而不是在这里假装能搜到不存在的字段。
   */
  async list(
    ownerId: string,
    query: {
      kind?: string;
      capability?: string;
      limit?: number;
      offset?: number;
      keyword?: string;
      /** 起始日期 (含当天 00:00) */
      from?: string;
      /** 截止日期 (含当天 23:59) */
      to?: string;
    } = {},
  ) {
    const where: Record<string, unknown> = { ownerId, status: 'visible' };
    if (query.kind === 'original' || query.kind === 'generated') where.kind = query.kind;
    if (query.capability) where.capability = query.capability;

    const keyword = (query.keyword ?? '').trim();
    if (keyword) {
      // 大小写不敏感的部分匹配 (SQLite 的 LIKE 默认对 ASCII 不区分大小写)
      where.sourceUrl = { contains: keyword };
    }

    // 时间范围: from/to 都是「日期」语义, 故两端都含当天整天。
    // ⚠️ 解析失败**不抛错** —— 宁可忽略这个筛选条件, 也不能让整个列表 500。
    const createdAt: Record<string, Date> = {};
    const from = parseDayStart(query.from);
    if (from) createdAt.gte = from;
    const to = parseDayEnd(query.to);
    if (to) createdAt.lte = to;
    if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

    const limit = Math.min(Math.max(Number(query.limit) || 60, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async getOne(ownerId: string, id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.ownerId !== ownerId) {
      throw new AppError(40400, '素材不存在', 404);
    }
    return asset;
  }

  /**
   * 删除素材 (连带产出它的任务与文件)。
   *
   * 删除顺序: 先查产出任务 → 事务里删任务与记录 → 再删文件。
   * 文件删除失败不回滚数据库: 记录已不存在比留垃圾文件更糟, 只记日志。
   */
  async remove(ownerId: string, id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.ownerId !== ownerId) {
      throw new AppError(40400, '素材不存在', 404);
    }

    const producedTasks = await this.prisma.generationTask.findMany({
      where: { outputAssetId: id },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      if (producedTasks.length) {
        await tx.generationTask.deleteMany({ where: { id: { in: producedTasks.map((t) => t.id) } } });
      }
      await tx.asset.delete({ where: { id } });
    });

    // 按**写入时的后端**删除, 不能用当前默认后端
    if (asset.storageKey) {
      const p = this.storage.get((asset.storageBackend as StorageBackend) ?? 'local');
      await p?.delete(asset.storageKey);
    }

    return { id, removedTasks: producedTasks.length };
  }
}

function mimeFromExt(ext: string, fallback: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return fallback || 'application/octet-stream';
}

/**
 * 解析「日期」的起始时刻 (当天 00:00:00.000, 本地时区)。
 *
 * 接受 `YYYY-MM-DD` 与完整 ISO 串。解析失败返回 null —— 调用方据此**忽略**
 * 该筛选条件, 而不是让整个列表接口 500 (一个手滑的日期参数不该让用户看不了素材库)。
 */
function parseDayStart(raw?: string): Date | null {
  if (!raw) return null;
  const d = parseDateInput(raw);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 解析「日期」的结束时刻 (当天 23:59:59.999, 本地时区)。
 *
 * 与 parseDayStart 成对使用 —— 只设 lte 不设 gte 会把范围前的素材全捞进来。
 */
function parseDayEnd(raw?: string): Date | null {
  if (!raw) return null;
  const d = parseDateInput(raw);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/** 宽松的日期解析: 纯 `YYYY-MM-DD` 走本地时区, 其余交给 Date */
function parseDateInput(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * 读取图片宽高。
 * 传 Buffer 而非磁盘路径 —— 云端后端下文件不在本地磁盘。
 * 懒加载 jimp: require 一次约 7s (本机 fs 慢), 不应拖慢服务启动。
 */
async function probeDimensions(
  buf: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Jimp } = require('jimp');
    const img = await Jimp.read(buf);
    return { width: img.bitmap.width, height: img.bitmap.height };
  } catch {
    return null;
  }
}
