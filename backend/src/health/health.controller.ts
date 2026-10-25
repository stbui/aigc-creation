/**
 * 健康检查。
 *
 * 两个端点，用途不同，**不要合并**：
 *   · `GET /health`        —— 给人看的诊断面板：数据库、存储、三条模型通道
 *                            各自的状态与延迟。永远返回 200（除非进程起不来），
 *                            部分降级时 `status='degraded'`。
 *   · `GET /health/ready`  —— 给编排系统看的就绪探针：只有「关键依赖可用」
 *                            才返回 200，否则 503。Docker/K8s 据此决定
 *                            要不要把流量打进来。
 *
 * 关键依赖只有数据库：模型通道全部不可用时，生成任务会明确失败并退款，
 * 但后台管理与排障入口仍应可用。存储不可用时上传/生成同样会失败 ——
 * 这些属于业务降级，不该让整个实例被摘除。
 *
 * 存储探测带 30 秒缓存：OSS/MinIO 的连通性探测要发网络请求，
 * 探针 5 秒一次会把一个纯读接口变成对外部服务的压力源。
 */
import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChannelRepository } from '../providers/channel-repository';
import { AppError } from '../common/app.exception';
import { currentRequestId } from '../common/request-context';
import type { Modality } from '../providers/modality';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

const STORAGE_PROBE_TTL_MS = 30_000;
const MODALITIES: Modality[] = ['image', 'text', 'video'];

function pkgVersion(): string {
  try {
    // dist/health/health.controller.js → ../../package.json = backend/package.json
    return String(require('../../package.json').version ?? '0.0.0');
  } catch {
    return 'unknown';
  }
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private storageCache: { at: number; value: CheckResult } | null = null;
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly channels: ChannelRepository,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async health() {
    const [db, storage, channels] = await Promise.all([
      this.checkDb(),
      this.checkStorage(),
      this.checkChannels(),
    ]);

    const degraded = !db.ok || !storage.ok || MODALITIES.some((m) => channels[m]?.ok === false);

    return {
      status: degraded ? 'degraded' : 'ok',
      version: pkgVersion(),
      env: this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development',
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      requestId: currentRequestId() ?? null,
      checks: { db, storage, channels },
    };
  }

  @Get('ready')
  async ready() {
    const db = await this.checkDb();
    if (!db.ok) {
      // 503 由统一异常过滤器包成 { code, data: null, message }
      throw new AppError(50301, `数据库不可用: ${db.message ?? '未知原因'}`, 503);
    }
    return { ready: true, db, timestamp: new Date().toISOString() };
  }

  private async checkDb(): Promise<CheckResult> {
    const start = Date.now();
    try {
      // 真实走一次库：连接池/文件锁/wal 的问题只有发查询才暴露，
      // 用进程内标记判断等于自欺欺人
      await this.prisma.user.findFirst({ select: { id: true } });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      this.logger.error(`数据库健康检查失败: ${(e as Error).message}`);
      return { ok: false, latencyMs: Date.now() - start, message: (e as Error).message };
    }
  }

  private async checkStorage(): Promise<CheckResult & { backend?: string; cached?: boolean }> {
    // getActive() 对「配置了但没就绪」的后端会抛错 (拒绝静默回落本地盘),
    // 健康检查要能如实报出这条原因, 而不是自己 500。
    let backend: string;
    try {
      backend = this.storage.getActive().backend;
    } catch (e) {
      // latencyMs 用 0: 这里没真的探测存储, 是配置/依赖缺失直接判死
      return { ok: false, latencyMs: 0, message: (e as Error).message };
    }
    if (this.storageCache && Date.now() - this.storageCache.at < STORAGE_PROBE_TTL_MS) {
      return { ...this.storageCache.value, backend, cached: true };
    }
    const start = Date.now();
    let value: CheckResult;
    try {
      const probe = await this.storage.getActive().probe();
      value = { ok: probe.ok, latencyMs: probe.latencyMs ?? Date.now() - start, message: probe.message };
    } catch (e) {
      value = { ok: false, latencyMs: Date.now() - start, message: (e as Error).message };
    }
    this.storageCache = { at: Date.now(), value };
    return { ...value, backend, cached: false };
  }

  private async checkChannels(): Promise<
    Record<string, { ok: boolean; source: string; available: number; total: number; cooling: number; message?: string }>
  > {
    const out: Record<string, any> = {};
    for (const modality of MODALITIES) {
      try {
        const snap = await this.channels.snapshot(modality);
        // 没有任何线路不算进程级故障，但该模态能力会不可提交/失败并退款。
        // 这里只如实汇报"可用的有几条"，由调用方判断这对当前部署意味着什么。
        out[modality] = {
          ok: snap.availableCount > 0,
          source: snap.source,
          available: snap.availableCount,
          total: snap.total,
          cooling: snap.coolingCount,
        };
      } catch (e) {
        out[modality] = { ok: false, source: 'unknown', available: 0, total: 0, cooling: 0, message: (e as Error).message };
      }
    }
    return out;
  }
}
