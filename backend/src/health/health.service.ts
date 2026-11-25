/**
 * 健康检查实现。
 *
 * Controller 只保留路由；数据库、存储与线路探测全部在这里完成。
 * 两个入口的语义差异见 health.controller.ts 顶部说明。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/app.exception';
import { currentRequestId } from '../common/request-context';
import { AppFileLogger } from '../common/logger/file-logger';
import type { Modality } from '../common/modality';
import { RouteHealthService } from '../model/routing/route-health.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

/** 一种模态的供应侧概况 */
interface ModalityChannels {
  ok: boolean;
  /** 该模态未删除的渠道模型总数 */
  total: number;
  /** 其中自身启用、且所属渠道启用未删的线路数 */
  enabled: number;
  /** 在上述基础上再排除冷却中的渠道 / 渠道模型 */
  available: number;
  cooling: number;
  message?: string;
}

const STORAGE_PROBE_TTL_MS = 30_000;
const MODALITIES: Modality[] = ['image', 'text', 'video'];

function pkgVersion(): string {
  try {
    // dist/health/health.service.js → ../../package.json = backend/package.json
    return String(require('../../package.json').version ?? '0.0.0');
  } catch {
    return 'unknown';
  }
}

@Injectable()
export class HealthService {
  private static readonly STORAGE_PROBE_CACHE_KEY = 'health:storage-probe';
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly routeHealth: RouteHealthService,
    private readonly config: ConfigService,
    private readonly logger: AppFileLogger,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** 诊断面板：永远返回 200，部分降级时 `status='degraded'` */
  async report() {
    const [db, storage, channels] = await Promise.all([
      this.checkDb(),
      this.checkStorage(),
      this.checkChannels(),
    ]);

    const degraded =
      !db.ok || !storage.ok || MODALITIES.some((m) => channels[m]?.ok === false);

    return {
      status: degraded ? 'degraded' : 'ok',
      version: pkgVersion(),
      env: this.config.get<string>('app.env') ?? 'development',
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      requestId: currentRequestId() ?? null,
      checks: { db, storage, channels },
    };
  }

  /** 就绪探针：数据库不可用时抛 503，由统一异常过滤器包装 */
  async readiness() {
    const db = await this.checkDb();
    if (!db.ok) {
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
      this.logger.error(`数据库健康检查失败: ${(e as Error).message}`, 'HealthService');
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
    const cached = await this.cache.get<CheckResult>(HealthService.STORAGE_PROBE_CACHE_KEY);
    if (cached !== undefined) {
      return { ...cached, backend, cached: true };
    }
    const start = Date.now();
    let value: CheckResult;
    try {
      const probe = await this.storage.getActive().probe();
      value = {
        ok: probe.ok,
        latencyMs: probe.latencyMs ?? Date.now() - start,
        message: probe.message,
      };
    } catch (e) {
      value = { ok: false, latencyMs: Date.now() - start, message: (e as Error).message };
    }
    await this.cache.set(HealthService.STORAGE_PROBE_CACHE_KEY, value, STORAGE_PROBE_TTL_MS);
    return { ...value, backend, cached: false };
  }

  /**
   * 三种模态的线路概况。
   *
   * 口径与调度器一致：**渠道模型是线路的最小单位**，渠道停用即其下所有模型不可用；
   * 冷却中的键来自 `RouteHealthService`（进程内，只反映本实例）。
   * 没有任何可用线路不算进程级故障，但该模态能力会不可提交 / 失败并退款 ——
   * 这里只如实汇报「可用的有几条」，由调用方判断这对当前部署意味着什么。
   */
  private async checkChannels(): Promise<Record<string, ModalityChannels>> {
    const out: Record<string, ModalityChannels> = {};
    try {
      const blocked = new Set(this.routeHealth.snapshot().map((block) => block.key));
      const [channels, models] = await Promise.all([
        this.prisma.modelChannel.findMany({
          where: { enabled: true, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.channelModel.findMany({
          where: { deletedAt: null },
          select: { id: true, channelId: true, capability: true, enabled: true },
        }),
      ]);
      const liveChannelIds = new Set(channels.map((row) => row.id));
      for (const modality of MODALITIES) {
        const rows = models.filter((row) => row.capability === modality);
        const live = rows.filter((row) => liveChannelIds.has(row.channelId));
        const cooling = live.filter(
          (row) => blocked.has(`channel:${row.channelId}`) || blocked.has(`channel-model:${row.id}`),
        );
        const usable = live.filter(
          (row) =>
            row.enabled &&
            !blocked.has(`channel:${row.channelId}`) &&
            !blocked.has(`channel-model:${row.id}`),
        );
        out[modality] = {
          ok: usable.length > 0,
          total: rows.length,
          enabled: live.filter((row) => row.enabled).length,
          available: usable.length,
          cooling: cooling.length,
        };
      }
    } catch (e) {
      for (const modality of MODALITIES) {
        out[modality] = {
          ok: false,
          total: 0,
          enabled: 0,
          available: 0,
          cooling: 0,
          message: (e as Error).message,
        };
      }
    }
    return out;
  }
}
