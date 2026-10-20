import { Injectable, Logger } from '@nestjs/common';
import { MockImageProvider } from './mock-image.provider';
import { createImageProvider } from './protocols/provider-factory';
import { ChannelScheduler } from './channel-scheduler';
import { gatewayConfig, setGatewayConfigOverrides, invalidateGatewayConfigCache } from './gateway.config';
import { buildPromptFor } from './gateway-prompt';
import { CAPABILITIES } from '../capabilities/capability.registry';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCallLogger } from './image-call-logger';
import type { ImageProvider, ImageProviderResult } from './image-provider.interface';
import type { CapabilityRoute } from './gateway.types';

/**
 * 能力路由器 —— IMAGE_PROVIDER 的真实实现 (统一生成通道入口)。
 *
 * 15 项能力(原 7 项本地算法 + 8 项 mock)都从这里出去, 逐能力决策:
 *   route=local  → 直接本地 Jimp 算法
 *   route=remote → 强制走真实模型 (失败也回落本地, 不让用户空手)
 *   route=auto   → 网关已配置则远程, 否则本地
 *
 * 远程通道按**协议**分派 (2026-10-20 架构重构后):
 *   aigc      → 异步任务制 POST /generation/tasks + 轮询
 *   openai    → 同步 OpenAI 兼容 POST /v1/images/generations
 *                (优云智算 / 硅基流动 / OpenAI 官方 三家共用)
 *   volcengine→ POST {base}/images/generations, size 用档位
 *   minimax   → POST {base}/v1/image_generation, 用 aspect_ratio
 *
 * 协议形状 (端点/参数/响应解包) 全部由协议层声明, 本类只负责
 * 「按标识拿实现」—— 见 protocols/provider-factory.ts。
 * 未知协议**显式抛错**而非静默当 aigc 处理 —— 后者会把「协议填错」变成
 * 404 → 回落本地占位图的静默失败, 运营从界面上看不出来。
 *
 * 配置来源: 每次生成前从 ModelChannelConfig 表拉一次覆盖值注入 gateway.config,
 * 使后台「模型配置」页的改动即时生效 (无需重启)。带 3s 缓存, 不把 SQLite
 * 拖成每任务两次查表。
 *
 * 产出会带上 `source` (gateway/local), 由 generate.service 落库到 task.provider,
 * 前端据此如实显示「真实模型」或「本地算法」, 不再一律标 placeholder。
 * 同时每次调用都写一条 ModelCallLog (耗时/成败/回落原因), 供后台「模型调用记录」页。
 */
@Injectable()
export class CapabilityRouterProvider implements ImageProvider {
  private readonly log = new Logger(CapabilityRouterProvider.name);
  private readonly local = new MockImageProvider();

  /**
   * 协议 → provider 实现。
   *
   * ⚠️ 未知协议**不静默回落到 aigc**: 那会让「填错协议」表现为 404 → 回落本地占位图,
   * 正是本项目反复要消除的静默失败。故未知值显式抛, 由 generate 的 catch
   * 转成可见的失败原因(ModelCallLog 里能查到"未知协议 xxx")。
   */
  private pickProtocol(protocol: string) {
    return createImageProvider(protocol);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly callLogger: ImageCallLogger,
    private readonly scheduler: ChannelScheduler,
  ) {
    // 启动时先拉一次, 让首条任务不必等这次查询
    void this.refreshConfig();
  }

  async generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
  ): Promise<ImageProviderResult> {
    await this.refreshConfig();

    const cfg = gatewayConfig();
    const route = cfg.routeOf(capability);
    const startedAt = Date.now();

    // route=local: 明确要求本地, 不算回落
    if (route === 'local') {
      return this.runLocal(capability, inputPaths, params, route, startedAt, null);
    }

    // auto 且网关未配置: 直接本地, reason 说明为何没走远程
    if (!cfg.enabled) {
      return this.runLocal(capability, inputPaths, params, route, startedAt, '网关未配置（基址与令牌均为空）');
    }

    const prompt = buildPromptFor(capability, params);

    /*
     * 多渠道调度 (2026-10-20): 按 priority 顺序试各通道, 失败换下一家。
     *
     * ⚠️ 与改造前的差别: 以前只调 `cfg.provider` 指定的**一家**。
     * 那家限流/挂掉时, 即便运营在后台配过别家也**不会**被用上 ——
     * 因为压根没有"多家"这个概念。现在同模态下可配多家, 互为灾备。
     *
     * 分派仍必须在 try 内: 协议未接入等配置错误会抛, 它应与通道失败
     * 走同一条回落路径, 并把原因写进 ModelCallLog.reason (静默失败照样看得见)。
     */
    try {
      const dispatch = await this.scheduler.dispatch('image', async (channel) => {
        // 通道自带协议与凭据 —— 用它覆盖全局配置, 使每家走自己的端点与令牌
        const gateway = this.pickProtocol(channel.protocol);
        return gateway.generate(capability, inputPaths, params, prompt);
      });

      if (!dispatch.ok || !dispatch.value) {
        /*
         * 全部通道失败 → 回落本地算法 (图像的兜底)。
         *
         * ⚠️ reason 要带上**每条通道各自失败的原因**: 只写"全部失败"的话,
         * 运营无法判断是"第一家限流"还是"第三家协议填错" —— 而那正是
         * 排障时最需要的信息。故把 attempts 折叠成一行摘要。
         */
        const summary = dispatch.attempts
          .map((a) => `${a.channelName}(${a.protocol}): ${a.reason ?? a.ok ? '成功' : '失败'}`)
          .join('; ');
        const reason = dispatch.unavailableReason
          ? `${dispatch.unavailableReason} — ${summary}`
          : summary;
        this.log.warn(`${capability}: 真实模型通道全部失败, 回落本地算法 — ${reason}`);
        return this.runLocal(capability, inputPaths, params, route, startedAt, reason, true);
      }

      const r = dispatch.value;
      const used = dispatch.channel!;
      this.log.log(`${capability}: 走真实模型通道成功 (${used.name}/${used.protocol} ${r.taskId ?? '-'} ${r.model ?? ''})`);
      await this.callLogger.logSuccess({
        capability,
        params,
        prompt,
        route,
        source: 'gateway',
        // 模态固定为 image —— 本路由器只服务图像能力
        modality: 'image',
        // ⚠️ 模型名取**实际走通的那条通道**的配置, 不是全局默认 ——
        // 多渠道下两者可能不同 (第二家的模型名往往不一样)
        model: r.model ?? used.protocol,
        gatewayTaskId: r.taskId,
        durationMs: Date.now() - startedAt,
        buffer: r.buffer,
      });
      return { kind: 'image', buffer: r.buffer, format: r.format, source: 'gateway' };
    } catch (e) {
      const reason = (e as Error).message ?? String(e);
      this.log.warn(`${capability}: 真实模型通道失败, 回落本地算法 — ${reason}`);
      // 远程失败后走本地, 这才是「回落」; 失败原因落进调用记录供排障
      return this.runLocal(capability, inputPaths, params, route, startedAt, reason, true);
    }
  }

  /**
   * 拉取后台配置覆盖值并注入 gateway.config。
   *
   * 失败不阻断生成 —— 配置表读不到时退回 env/默认值, 生成链路照常工作。
   */
  private async refreshConfig(): Promise<void> {
    try {
      const rows = await this.prisma.modelChannelConfig.findMany({
        where: { overridden: true },
        select: { key: true, value: true },
      });
      setGatewayConfigOverrides(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    } catch (e) {
      this.log.warn(`读取模型通道配置失败, 退回环境变量/默认值 — ${(e as Error).message}`);
    }
  }

  /** 供后台保存配置后立即失效缓存, 使改动即时生效 */
  invalidate(): void {
    invalidateGatewayConfigCache();
  }

  /**
   * 统一跑本地算法并记录一次调用。
   *
   * local 也算一次调用 —— 否则记录页会漏掉全部兜底流量, 而那恰恰是排障时最想看的。
   */
  private async runLocal(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
    route: CapabilityRoute,
    startedAt: number,
    reason: string | null,
    fallback = false,
  ): Promise<ImageProviderResult> {
    const prompt = buildPromptFor(capability, params);
    try {
      const r = await this.local.generate(capability, inputPaths, params);
      await this.callLogger.logSuccess({
        capability,
        params,
        prompt,
        route,
        source: 'local',
        // 模态固定为 image —— 本路由器只服务图像能力
        modality: 'image',
        model: '',
        durationMs: Date.now() - startedAt,
        buffer: r.buffer,
        fallback,
        reason,
      });
      return { kind: 'image', ...r, source: 'local' };
    } catch (e) {
      await this.callLogger.logFailure({
        capability,
        params,
        prompt,
        route,
        source: 'local',
        // 模态固定为 image —— 本路由器只服务图像能力
        modality: 'image',
        durationMs: Date.now() - startedAt,
        fallback,
        reason: reason ?? (e as Error).message ?? String(e),
      });
      throw e;
    }
  }

  /** 当前路由表快照 (供 /api/v1/capabilities 下发给前端展示真实来源) */
  routingSnapshot(): Record<string, { route: CapabilityRoute; effective: 'gateway' | 'local' }> {
    const cfg = gatewayConfig();
    const out: Record<string, { route: CapabilityRoute; effective: 'gateway' | 'local' }> = {};
    for (const c of CAPABILITIES.map((x) => x.id)) {
      const route = cfg.routeOf(c);
      out[c] = {
        route,
        effective: route === 'local' || !cfg.enabled ? 'local' : 'gateway',
      };
    }
    return out;
  }
}