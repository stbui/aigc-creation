import { Injectable, Logger } from '@nestjs/common';
import { createImageProvider } from './protocols/provider-factory';
import { protocolSpec } from './protocols/protocol.spec';
import { ChannelScheduler } from './channel-scheduler';
import { gatewayConfig, setGatewayConfigOverrides, invalidateGatewayConfigCache } from './gateway.config';
import { buildPromptFor } from './gateway-prompt';
import { CAPABILITIES, getCapability } from '../capabilities/capability.registry';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCallLogger } from './image-call-logger';
import type { ImageProvider, ImageProviderResult } from './image-provider.interface';
import {
  ImageEditUnsupportedError,
  MaskUnsupportedError,
  NoModelChannelError,
  type CapabilityRoute,
  type GatewayResult,
} from './gateway.types';
import type { ChannelDispatch } from './channel-scheduler';

/**
 * 能力路由器 —— 所有图像能力唯一的生成入口。
 *
 * 2026-10-25 起只允许真实模型产出：
 *   route=auto / remote → 按优先级尝试已配置的模型线路；
 *   route=local         → 存量配置兼容，明确失败并退款，不执行任何本地生成；
 *   无可用线路           → failed/42204；
 *   线路存在但全部失败   → failed/42201；
 *   遮罩重绘无编辑端点   → failed/42205。
 *
 * 所有失败都由 generate.service 统一退款。这里不再有本地算法兜底，
 * 也不会把一张本地合成的图片标记成模型结果。
 */
@Injectable()
export class CapabilityRouterProvider implements ImageProvider {
  private readonly log = new Logger(CapabilityRouterProvider.name);

  /**
   * 协议 → provider 实现。
   *
   * 未知协议显式抛错，由调度器记为一次失败；绝不静默换协议或产出本地结果。
   */
  private pickProtocol(protocol: string) {
    return createImageProvider(protocol);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly callLogger: ImageCallLogger,
    private readonly scheduler: ChannelScheduler,
  ) {
    // 启动时先拉一次，让首条任务不必等这次查询
    void this.refreshConfig();
  }

  /**
   * @param maskPath 遮罩 PNG 的本地路径（局部重绘/手动去水印用，可选）。
   *
   * 通道不接受遮罩/编辑底图时换下一条支持 edits 的线路；全部不支持时判 42205。
   * 不允许「忽略遮罩或参考图继续生成」——前者会把局部修改变成整图重绘，
   * 后者会把商品换色变成文生图（上传水壶却生成手提包）。
   */
  async generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
    maskPath?: string,
  ): Promise<ImageProviderResult> {
    await this.refreshConfig();

    const cfg = gatewayConfig();
    const route = cfg.routeOf(capability);
    const startedAt = Date.now();

    if (route === 'local') {
      const reason = '本地生成已停用；请将该能力的路由改为 auto 或 remote，并配置可用的模型通道';
      this.log.warn(`${capability}: 存量路由为 local，按不可用处理`);
      return this.failWithoutChannel(capability, params, route, startedAt, reason);
    }

    const prompt = buildPromptFor(capability, params);
    const requireImageEdit =
      !maskPath && inputPaths.length > 0 && getCapability(capability)?.inputImageMode === 'edit';

    let dispatch: ChannelDispatch<GatewayResult>;
    /*
     * 有几条线路的协议真正能接收遮罩。调度器只记录每次尝试的成败，
     * 不知道协议能力，故这里单独统计：全部线路都不支持时是配置问题（42205），
     * 而不是网络/额度问题（42201）。
     */
    let maskCapableChannels = 0;
    try {
      dispatch = await this.scheduler.dispatch('image', async (channel) => {
        const gateway = this.pickProtocol(channel.protocol);
        if (maskPath || requireImageEdit) {
          const support = protocolSpec(channel.protocol)?.maskSupport ?? 'none';
          if (support !== 'edits') {
            throw requireImageEdit
              ? new ImageEditUnsupportedError(`${channel.name} (${channel.protocol}) 没有图像编辑端点`)
              : new MaskUnsupportedError(`${channel.name} (${channel.protocol}) 没有图像编辑端点`);
          }
          maskCapableChannels += 1;
        }
        if ('withChannel' in gateway && typeof gateway.withChannel === 'function') {
          gateway.withChannel({
            baseUrl: channel.baseUrl,
            token: channel.token,
            model: channel.model,
          });
        }
        return gateway.generate(capability, inputPaths, params, prompt, maskPath, requireImageEdit);
      });
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      if ((maskPath || requireImageEdit) && e instanceof MaskUnsupportedError) {
        return this.failWithMaskUnsupported(capability, params, route, startedAt, reason);
      }
      return this.failGeneration(capability, params, route, startedAt, reason);
    }

    if (!dispatch.ok || !dispatch.value) {
      /*
       * 原因要带上每条线路各自的失败信息：只写「全部失败」无法区分
       * 第一家限流、第二家额度不足与第三家协议填错。
       */
      const summary = dispatch.attempts
        .map((a) => `${a.channelName}(${a.protocol}): ${a.reason ?? (a.ok ? '成功' : '失败')}`)
        .join('; ');
      const reason = [dispatch.unavailableReason, summary].filter(Boolean).join(' — ');

      // 有线路被尝试过、但没有任何一条支持遮罩 → 42205（换协议，而不是重试）
      if ((maskPath || requireImageEdit) && dispatch.attempts.length > 0 && maskCapableChannels === 0) {
        return this.failWithMaskUnsupported(
          capability,
          params,
          route,
          startedAt,
          reason ||
            (requireImageEdit
              ? '当前线路均不支持图像编辑，请在后台改用 openai 协议的图像线路'
              : '当前线路均不支持遮罩重绘，请在后台改用 openai 协议的图像线路'),
        );
      }

      // 一条线路都没尝试（未配置/全部停用/全部冷却）→ 42204
      if (dispatch.attempts.length === 0) {
        return this.failWithoutChannel(
          capability,
          params,
          route,
          startedAt,
          reason || '未配置可用的图像模型通道',
        );
      }

      // 尝试过真实模型但全部失败 → 42201，按上游生成异常处理
      return this.failGeneration(
        capability,
        params,
        route,
        startedAt,
        reason || '模型通道全部失败',
      );
    }

    const r = dispatch.value;
    const used = dispatch.channel!;
    this.log.log(
      `${capability}: 模型通道成功 (${used.name}/${used.protocol} ${r.taskId ?? '-'} ${r.model ?? ''})`,
    );
    await this.callLogger.logSuccess({
      capability,
      params,
      prompt,
      route,
      source: 'gateway',
      modality: 'image',
      // 实际走通的线路模型名优先；多渠道下它可能与全局默认不同
      model: r.model ?? used.protocol,
      gatewayTaskId: r.taskId,
      durationMs: Date.now() - startedAt,
      buffer: r.buffer,
    });
    return { kind: 'image', buffer: r.buffer, format: r.format, source: 'gateway' };
  }

  /** 无可用线路：记录一次失败，抛终局错误（42204） */
  private async failWithoutChannel(
    capability: string,
    params: Record<string, any>,
    route: CapabilityRoute,
    startedAt: number,
    reason: string,
  ): Promise<never> {
    await this.recordFailure(capability, params, route, startedAt, reason, '42204');
    throw new NoModelChannelError(reason);
  }

  /** 遮罩重绘无可用编辑线路：42205，与「没配线路」区分 */
  private async failWithMaskUnsupported(
    capability: string,
    params: Record<string, any>,
    route: CapabilityRoute,
    startedAt: number,
    reason: string,
  ): Promise<never> {
    await this.recordFailure(capability, params, route, startedAt, reason, '42205');
    throw new MaskUnsupportedError(reason);
  }

  /** 有线路但生成失败：42201，按真实上游异常处理并退款 */
  private async failGeneration(
    capability: string,
    params: Record<string, any>,
    route: CapabilityRoute,
    startedAt: number,
    reason: string,
  ): Promise<never> {
    await this.recordFailure(capability, params, route, startedAt, reason, '42201');
    throw new Error(`模型通道生成失败: ${reason}`);
  }

  private async recordFailure(
    capability: string,
    params: Record<string, any>,
    route: CapabilityRoute,
    startedAt: number,
    reason: string,
    errorCode: '42201' | '42204' | '42205',
  ): Promise<void> {
    await this.callLogger.logFailure({
      capability,
      params,
      prompt: buildPromptFor(capability, params),
      route,
      source: 'gateway',
      modality: 'image',
      durationMs: Date.now() - startedAt,
      fallback: false,
      reason,
      errorCode,
    });
  }

  /**
   * 拉取后台配置覆盖值并注入 gateway.config。
   *
   * 失败不阻断生成 —— 配置表读不到时退回 env/默认值。
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

  /** 供后台保存配置后立即失效缓存，使改动即时生效 */
  invalidate(): void {
    invalidateGatewayConfigCache();
  }

  /** 当前路由表快照（仅用于诊断；新任务不会产生 local 产出） */
  routingSnapshot(): Record<string, { route: CapabilityRoute; effective: 'gateway' | 'unavailable' }> {
    const cfg = gatewayConfig();
    const out: Record<string, { route: CapabilityRoute; effective: 'gateway' | 'unavailable' }> = {};
    for (const c of CAPABILITIES.map((x) => x.id)) {
      const route = cfg.routeOf(c);
      out[c] = {
        route,
        effective: route === 'local' || !cfg.enabled ? 'unavailable' : 'gateway',
      };
    }
    return out;
  }
}
