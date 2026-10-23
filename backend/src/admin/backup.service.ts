import { Injectable, Logger } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { sqliteUrlToPath } from '../config/env-files';

/** 备份文件名前缀, 便于人工识别 */
const FILE_PREFIX = 'huojue-dev';
const FILE_SUFFIX = '.db';

/**
 * 允许被清理的业务表。
 *
 * ⚠ 刻意**不含** User / Project / Asset / GenerationTask 的直接删除:
 * 用户的原始上传素材属个人数据, 需走注销流程匿名化, 不能按时间批量清。
 * 本期只清理「运行痕迹」类数据 —— 它们不影响业务连续性但会无限增长。
 */
const CLEANUP_TABLES = [
  'AdminAuditLog',
  'CleanupLog',
  'BackupRecord',
  // 模型调用记录是排障数据, 不承载交易事实, 故可按时间清理。
  // 加入时须同步 admin/retention.controller.ts 的 TARGETS —— 两处不一致
  // 会让界面上能选的表被后端拒绝 (或被后端接受却不在界面里)。
  'ModelCallLog',
] as const;

export interface BackupRow {
  id: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  trigger: string;
  status: string;
  errorMessage: string | null;
  sourceSizeBytes: number | null;
  verified: boolean;
  verifiedAt: string | null;
  verifyReport: string | null;
  verifyWarnings: string | null;
  createdAt: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 备份目录: backend/backups/。
   *
   * 取自配置层 BACKUP_DIR —— 三环境各写各的目录, 否则 test 环境的定时备份
   * 会把文件混进开发环境的备份列表里, 而恢复验证是按目录扫描的。
   */
  private get backupDir(): string {
    const raw = this.config.get<string>('path.backups') ?? 'backups';
    return resolve(process.cwd(), raw);
  }

  /**
   * 生产库路径: 与 PrismaService 的 adapter 保持一致。
   *
   * 两者读同一个 DATABASE_URL, 故这里用 sqliteUrlToPath 而非写死 dev.db ——
   * 写死的话 test/production 会去备份开发库, 备份记录指向一个永远不变的库,
   * 表面成功实际无效。
   */
  private get dbPath(): string {
    return sqliteUrlToPath(this.config.get<string>('db.url') ?? 'file:./dev.db', process.cwd());
  }

  /**
   * 执行一次备份。
   *
   * 用 `VACUUM INTO` 而非 `cp`: VACUUM INTO 是 SQLite 官方的一致性快照方式,
   * 在线完成且不会拷贝到写事务中间状态; cp 可能在 WAL 模式下拿到撕裂的库。
   *
   * 快照期间会短暂持有写锁, 但不阻塞读 —— 对本地 SQLite 场景足够。
   */
  async run(trigger: 'manual' | 'scheduled' = 'manual'): Promise<BackupRow> {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const filename = `${FILE_PREFIX}-${stamp}${FILE_SUFFIX}`;
    const target = join(this.backupDir, filename);

    if (!existsSync(this.dbPath)) {
      throw new AppError(50000, `数据库文件不存在: ${this.dbPath}`, 500);
    }

    const sourceSize = await this.fileSize(this.dbPath);

    // 先落记录再执行: 失败时也要留下失败痕迹, 否则"没记录"与"失败"无法区分
    const record = await this.prisma.backupRecord.create({
      data: {
        filename,
        sizeBytes: 0,
        sha256: '',
        trigger,
        status: 'pending',
        sourceSizeBytes: sourceSize,
      },
    });

    try {
      await fs.mkdir(this.backupDir, { recursive: true });

      // 若目标已存在(VACUUM INTO 不覆盖), 先移除 —— 同秒重试的场景
      if (existsSync(target)) await fs.unlink(target);

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      } finally {
        db.close();
      }

      const sizeBytes = await this.fileSize(target);
      const sha256 = await this.sha256(target);

      const updated = await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'succeeded', sizeBytes, sha256 },
      });

      this.logger.log(`备份完成: ${filename} (${sizeBytes} 字节)`);
      return this.toRow(updated);
    } catch (e) {
      const message = (e as Error).message;
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'failed', errorMessage: message.slice(0, 500) },
      });
      // 清理半成品文件, 避免残留占磁盘
      await fs.unlink(target).catch(() => undefined);
      this.logger.error(`备份失败: ${message}`);
      throw new AppError(50001, `备份失败: ${message}`, 500);
    }
  }

  /**
   * 恢复验证 (B-97)。
   *
   * 在**独立打开**备份文件的前提下检查三件事:
   *   1. `PRAGMA integrity_check` —— 文件未损坏
   *   2. 表结构完整 —— schema 与预期表名齐全
   *   3. 业务表可读且计数合理 —— 能真正用于恢复
   *
   * ⚠ 绝不覆盖生产库: 只读打开备份文件, 验证逻辑里没有任何写操作指向 dev.db。
   * 这是不可逆操作前唯一的保险, 验证本身必须零副作用。
   */
  async verify(id: string): Promise<BackupRow> {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record) throw new AppError(40400, '备份记录不存在', 404);
    if (record.status !== 'succeeded') {
      throw new AppError(40001, '备份未成功, 无法验证', 400);
    }

    const filePath = this.safePath(record.filename);
    if (!existsSync(filePath)) {
      await this.prisma.backupRecord.update({
        where: { id },
        data: { verified: false, verifyReport: null, verifyWarnings: '备份文件已丢失' },
      });
      throw new AppError(40400, '备份文件已丢失', 404);
    }

    const warnings: string[] = [];

    // 校验 SHA-256 是否与记录一致: 防止备份文件在落盘后被改动
    const actualSha = await this.sha256(filePath);
    if (record.sha256 && actualSha !== record.sha256) {
      warnings.push(`SHA-256 不一致(记录 ${record.sha256.slice(0, 12)}… / 实际 ${actualSha.slice(0, 12)}…), 文件可能在落盘后被改动`);
    }

    const report: string[] = [];
    let integrityOk = true;

    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      // 1. 完整性
      const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      const integrityResult = integrity[0]?.integrity_check ?? 'unknown';
      if (integrityResult !== 'ok') {
        integrityOk = false;
        report.push(`integrity_check=${integrityResult}`);
      } else {
        report.push('integrity_check=ok');
      }

      // 2. 表结构
      const tables = new Set(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map(
          (r) => r.name,
        ),
      );
      const REQUIRED = ['User', 'Project', 'Asset', 'GenerationTask', 'AdminRole', 'AdminAuditLog'];
      const missing = REQUIRED.filter((t) => !tables.has(t));
      if (missing.length > 0) {
        integrityOk = false;
        report.push(`缺失表: ${missing.join(', ')}`);
      } else {
        report.push(`表结构完整(${REQUIRED.length} 张关键表)`);
      }

      // 3. 业务表可读且计数合理
      for (const t of ['User', 'Project', 'Asset', 'GenerationTask']) {
        if (!tables.has(t)) continue;
        try {
          const rows = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number } | undefined;
          report.push(`${t}=${rows?.c ?? 0} 行`);
        } catch (e) {
          integrityOk = false;
          report.push(`${t} 不可读: ${(e as Error).message}`);
        }
      }
    } finally {
      db.close();
    }

    const updated = await this.prisma.backupRecord.update({
      where: { id },
      data: {
        verified: integrityOk,
        verifiedAt: new Date(),
        verifyReport: report.join('; '),
        verifyWarnings: warnings.length > 0 ? warnings.join(' | ') : null,
      },
    });

    this.logger.log(`备份验证: ${record.filename} → ${integrityOk ? '通过' : '失败'}`);
    return this.toRow(updated);
  }

  /** 备份列表 */
  async list() {
    const records = await this.prisma.backupRecord.findMany({ orderBy: { createdAt: 'desc' } });
    return records.map((r) => this.toRow(r));
  }

  /** 单条记录 */
  async detail(id: string) {
    const r = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!r) throw new AppError(40400, '备份记录不存在', 404);
    return this.toRow(r);
  }

  /**
   * 读取备份文件内容 (供下载)。
   *
   * ⚠ 只允许下载**已验证**的备份 (B-97: 无验证记录的备份视为无效)。
   * 这是刻意限制 —— 事故时才发现文件损坏就晚了。
   */
  async readForDownload(id: string): Promise<{ filename: string; buffer: Buffer }> {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record) throw new AppError(40400, '备份记录不存在', 404);
    if (record.status !== 'succeeded') {
      throw new AppError(40001, '备份未成功, 无法下载', 400);
    }
    if (!record.verified) {
      throw new AppError(40902, '该备份尚未通过恢复验证, 请先执行恢复验证', 409);
    }

    const filePath = this.safePath(record.filename);
    if (!existsSync(filePath)) {
      throw new AppError(40400, '备份文件已丢失', 404);
    }
    const buffer = await fs.readFile(filePath);
    return { filename: record.filename, buffer };
  }

  /**
   * 删除备份 (记录 + 文件)。
   *
   * 至少保留 1 份已验证备份: 全删掉等于没有备份, 比"备份过少"更糟。
   */
  async remove(id: string) {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record) throw new AppError(40400, '备份记录不存在', 404);

    const remaining = await this.prisma.backupRecord.count({
      where: { id: { not: id }, status: 'succeeded', verified: true },
    });
    if (remaining < 1) {
      throw new AppError(40901, '至少保留一份已验证的备份', 409);
    }

    const filePath = this.safePath(record.filename);
    await fs.unlink(filePath).catch(() => undefined);
    await this.prisma.backupRecord.delete({ where: { id } });
    return { id, filename: record.filename };
  }

  /**
   * 保留份数清理。
   *
   * 只清理「成功且已验证」的旧备份 —— 失败的留着没有意义,
   * 未验证的留着反而会误导 (UI 上标着未验证, 但磁盘被占着)。
   *
   * 返回被清理的数量, 供定时器记日志。
   */
  async prune(keepCount: number): Promise<{ removed: number; freedBytes: number }> {
    if (keepCount < 1) {
      throw new AppError(40001, '保留份数至少为 1', 400);
    }

    // 按创建时间倒序, 跳过前 keepCount 份
    const candidates = await this.prisma.backupRecord.findMany({
      where: { status: 'succeeded', verified: true },
      orderBy: { createdAt: 'desc' },
      skip: keepCount,
    });

    let removed = 0;
    let freedBytes = 0;
    for (const r of candidates) {
      await fs.unlink(this.safePath(r.filename)).catch(() => undefined);
      await this.prisma.backupRecord.delete({ where: { id: r.id } });
      removed += 1;
      freedBytes += r.sizeBytes;
    }

    if (removed > 0) {
      this.logger.log(`保留份数清理: 删除 ${removed} 份, 释放 ${freedBytes} 字节`);
    }
    return { removed, freedBytes };
  }

  /** 备份目录与总体积, 供前端展示磁盘占用 */
  async stats() {
    const records = await this.prisma.backupRecord.findMany();
    const succeeded = records.filter((r) => r.status === 'succeeded');
    const verified = succeeded.filter((r) => r.verified);
    const failed = records.filter((r) => r.status === 'failed');

    const totalBytes = succeeded.reduce((sum, r) => sum + r.sizeBytes, 0);
    const lastSuccess = succeeded
      .map((r) => r.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      total: records.length,
      succeeded: succeeded.length,
      verified: verified.length,
      /** 未验证的份数 —— 需要提醒运维尽快验证 */
      unverified: succeeded.length - verified.length,
      failed: failed.length,
      totalBytes,
      totalMb: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
      lastSuccessAt: lastSuccess ?? null,
      // 超过 24 小时没有成功备份即视为异常
      stale: lastSuccess ? Date.now() - lastSuccess.getTime() > 24 * 3600 * 1000 : true,
    };
  }

  /**
   * 到期数据清理 (B-100)。
   *
   * 只清理运行痕迹类表, 不碰业务数据 —— 用户的原始素材与订单不能按时间删。
   * 清理留痕写入 CleanupLog, 不可逆操作必须可追溯。
   */
  async cleanupExpired(
    target: string,
    retentionDays: number,
    trigger: 'manual' | 'scheduled' = 'manual',
  ) {
    if (!(CLEANUP_TABLES as readonly string[]).includes(target)) {
      throw new AppError(40001, `不支持清理目标: ${target}`, 400);
    }
    if (retentionDays < 1) {
      throw new AppError(40001, '保留天数至少为 1', 400);
    }

    const before = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const count = await tx[target as 'AdminAuditLog'].count({ where: { createdAt: { lt: before } } });
        const del = await tx[target as 'AdminAuditLog'].deleteMany({ where: { createdAt: { lt: before } } });

        // 清理自身也要留痕, 但不能清理自己的记录
        await tx.cleanupLog.create({
          data: {
            target,
            deletedCount: del.count,
            retentionDays,
            trigger,
            detail: JSON.stringify({ cutoff: before.toISOString(), matched: count }),
            success: true,
          },
        });
        return { count, deleted: del.count };
      });

      this.logger.log(`清理 ${target}: 删除 ${result.deleted} 条 (保留 ${retentionDays} 天)`);
      return { target, ...result, cutoff: before.toISOString() };
    } catch (e) {
      const message = (e as Error).message;
      await this.prisma.cleanupLog
        .create({
          data: {
            target,
            deletedCount: 0,
            retentionDays,
            trigger,
            success: false,
            errorMessage: message.slice(0, 500),
          },
        })
        .catch(() => undefined);
      throw new AppError(50002, `清理失败: ${message}`, 500);
    }
  }

  /** 清理留痕列表 */
  async cleanupLogs(limit = 50) {
    return this.prisma.cleanupLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 防路径穿越: 只允许访问备份目录下的文件名。
   *
   * filename 来自数据库, 一旦被注入 `../../etc/passwd` 就会造成任意文件读取。
   * 必须校验解析后的路径仍在备份目录之内。
   */
  private safePath(filename: string): string {
    const dir = this.backupDir;
    const full = resolve(dir, filename);
    if (!full.startsWith(dir + '/')) {
      throw new AppError(40001, '非法文件名', 400);
    }
    return full;
  }

  private async fileSize(path: string): Promise<number> {
    const st = await fs.stat(path);
    return st.size;
  }

  private async sha256(path: string): Promise<string> {
    const buf = await fs.readFile(path);
    return createHash('sha256').update(buf).digest('hex');
  }

  private toRow(r: {
    id: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
    trigger: string;
    status: string;
    errorMessage: string | null;
    sourceSizeBytes: number | null;
    verified: boolean;
    verifiedAt: Date | null;
    verifyReport: string | null;
    verifyWarnings: string | null;
    createdAt: Date;
  }): BackupRow {
    return {
      id: r.id,
      filename: r.filename,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      trigger: r.trigger,
      status: r.status,
      errorMessage: r.errorMessage,
      sourceSizeBytes: r.sourceSizeBytes,
      verified: r.verified,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      verifyReport: r.verifyReport,
      verifyWarnings: r.verifyWarnings,
      createdAt: r.createdAt.toISOString(),
    };
  }
}