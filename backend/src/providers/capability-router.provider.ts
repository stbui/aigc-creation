import { Injectable, Logger } from '@nestjs/common';
import { LocalImageProvider } from './local-image.provider';
import { createImageProvider } from './protocols/provider-factory';
import { protocolSpec } from './protocols/protocol.spec';
import { ChannelScheduler } from './channel-scheduler';
import { gatewayConfig, setGatewayConfigOverrides, invalidateGatewayConfigCache } from './gateway.config';
import { buildPromptFor } from './gateway-prompt';
import { CAPABILITIES, getCapability } from '../capabilities/capability.registry';
import { allowsLocalFallback } from '../capabilities/capability-plugin.type';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCallLogger } from './image-call-logger';
import type { ImageProvider, ImageProviderResult } from './image-provider.interface';
import { MaskUnsupportedError, NoModelChannelError, type CapabilityRoute, type GatewayResult } from './gateway.types';
import type { ChannelDispatch } from './channel-scheduler';

/**
 * 能力路由器 —— IMAGE_PROVIDER 的真实实现 (统一生成通道入口)。
 *
 * 16 项能力中的 15 项图像能力都从这里出去 (视频走 VideoCapabilityRouter), 逐能力决策:
 *   route=local  → 直接本地 Jimp 算法 (该能力不允许本地交付时判失败, 见下)
 *   route=remote → 强制走真实模型
 *   route=auto   → 网关已配置则远程, 否则本地
 *
 * ── 回落策略按能力区分 (2026-10-21) ────────────────────────────────
 * `allowsLocalFallback(def)` 为 true 的能力 (本地是**真实像素算法**, 如抠图/扩图):
 * 通道缺失或全部失败时回落本地, 用户不空手。
 *
 * 为 false 的能力 (本地**根本没有实现**: 创意生图 / 局部重绘 / 图片翻译 / 自由创作) 则
 * **没通道就失败、绝不交出任何本地产物** —— 抛 NoModelChannelError, 由 generate.service
 * 判 `failed/42204` 并退款。理由: 拿按参数画的示意图冒充模型产出比失败更糟,
 * 用户付了积分却拿到一张假图, 事后无从分辨。
 *
 * 远程通道按**协议**分派 (2026-10-20 架构重构后):
 *   openai    → 同步 OpenAI 兼容 POST /v1/images/generations
 *                (优云智算 / 硅基流动 / OpenAI 官方 三家共用)
 *   volcengine→ POST {base}/images/generations, size 用档位
 *   minimax   → POST {base}/v1/image_generation, 用 aspect_ratio
 *
 * 协议形状 (端点/参数/响应解包) 全部由协议层声明, 本类只负责
 * 「按标识拿实现」—— 见 protocols/provider-factory.ts。
 * 未知协议**显式抛错**而非静默回落到某个默认协议 —— 后者会把「协议填错」变成
 * 404 → 回落本地算法的静默失败, 运营从界面上看不出来。
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
  private readonly local = new LocalImageProvider();

  /**
   * 协议 → provider 实现。
   *
   * ⚠️ 未知协议**不静默回落到默认协议**: 那会让「填错协议」表现为 404 → 回落本地算法,
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

  /**
   * @param maskPath 遮罩 PNG 的本地路径（局部重绘用，可选）。
   *
   * 语义见 gateway.types 的 `MaskUnsupportedError`: 通道不接受遮罩时不是
   * 「跳过遮罩继续生成」，而是换一条能接收的通道；全部都不能接收时判失败。
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
    /*
     * 该能力是否允许交付本地产物。
     *
     * false = 本地根本没有实现 (创意生图 / 局部重绘 / 图片翻译 / 自由创作), 没通道就判失败;
     * true  = 本地是真实像素算法, 通道故障时回落, 用户不空手。
     * 判定与 `/capabilities` 的 runtime 共用 allowsLocalFallback(), 避免两处口径打架。
     */
    const allowLocal = this.allowsLocal(capability);

    // route=local: 明确要求本地, 不算回落
    if (route === 'local') {
      if (!allowLocal) {
        // 配置与能力策略冲突: 不交付假图优先, 原因写进调用记录
        this.log.warn(`${capability}: 路由被配置为 local, 但该能力不交付本地产物, 判失败`);
        return this.failWithoutChannel(
          capability, params, route, startedAt,
          '该能力不交付本地产物, 但逐能力路由被配置为 local',
        );
      }
      return this.runLocal(capability, inputPaths, params, route, startedAt, null);
    }

    /*
     * 不在这里用全局 `cfg.enabled` 拦截 —— 多渠道上线后，判断「有没有可用线路」
     * 是调度器的职责：表里有线路时，即使旧的 gateway.* 基址/令牌为空也必须走线路。
     * 调度器返回不可用时再回落本地（或按能力策略判失败），原因写进调用记录。
     */
    const prompt = buildPromptFor(capability, params);

    /*
     * 多渠道调度 (2026-10-20): 按 priority 顺序试各通道, 失败换下一家。
     *
     * ⚠️ 与改造前的差别: 以前只调 `cfg.provider` 指定的**一家**。
     * 那家限流/挂掉时, 即便运营在后台配过别家也**不会**被用上 ——
     * 因为压根没有"多家"这个概念。现在同模态下可配多家, 互为灾备。
     *
     * 分派必须在 try 内: 协议未接入等配置错误会抛, 它应与通道失败
     * 走同一条降级路径 (回落本地 / 判失败), 并把原因写进 ModelCallLog.reason。
     */
    let dispatch: ChannelDispatch<GatewayResult>;
    /*
     * 有几条通道的协议**真的能接收遮罩**。
     *
     * 调度器把每次尝试的失败都折成字符串（它对协议一无所知），故这里
     * 自己记一份：全部通道都不支持遮罩时，失败原因是「协议没有编辑端点」，
     * 与「通道挂了」是两件事 —— 前者重试一万次也不会变，该报 42205 让运营
     * 去换通道，后者才该提示网络/额度问题。
     */
    let maskCapableChannels = 0;
    try {
      dispatch = await this.scheduler.dispatch('image', async (channel) => {
        // 通道自带协议与凭据 —— 用它覆盖全局配置, 使每家走自己的端点与令牌。
        // ⚠️ 少了 withChannel 这一步, 多渠道就是假的: 切到第二条通道,
        // 发的仍是第一条的 baseUrl/token, 照样失败 (且看不出来)。
        const gateway = this.pickProtocol(channel.protocol);
        /*
         * 遮罩支持在**调 provider 之前**判定: 不支持就抛, 让调度器试下一条。
         * 放进 provider 里也能抛, 但那样每条不支持遮罩的通道都要真发一次
         * 请求（甚至可能被对方「接受并忽略遮罩」），把一次必然失败变成一次
         * 白花额度、还改了图的调用。
         */
        if (maskPath) {
          const support = protocolSpec(channel.protocol)?.maskSupport ?? 'none';
          if (support !== 'edits') {
            throw new MaskUnsupportedError(`${channel.name} (${channel.protocol}) 没有图像编辑端点`);
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
        return gateway.generate(capability, inputPaths, params, prompt, maskPath);
      });
    } catch (e) {
      const reason = (e as Error).message ?? String(e);
      /*
       * 调度器自身抛错（而非逐条通道失败）时，遮罩判定同样要排在前面，
       * 理由与下面 !dispatch.ok 分支一致：别把「协议收不了遮罩」报成「没通道」。
       */
      if (maskPath && maskCapableChannels === 0) {
        this.log.warn(`${capability}: 全部通道的协议都不支持遮罩重绘 — ${reason}`);
        return this.failWithoutChannel(capability, params, route, startedAt, reason, '42205');
      }
      if (!allowLocal) {
        this.log.warn(`${capability}: 真实模型通道失败, 该能力不交付本地产物, 判失败 — ${reason}`);
        return this.failWithoutChannel(capability, params, route, startedAt, reason);
      }
      this.log.warn(`${capability}: 真实模型通道失败, 回落本地算法 — ${reason}`);
      // 远程失败后走本地, 这才是「回落」; 失败原因落进调用记录供排障
      return this.runLocal(capability, inputPaths, params, route, startedAt, reason, true);
    }

    if (!dispatch.ok || !dispatch.value) {
      /*
       * 无可用线路 / 全部通道失败。
       *
       * ⚠️ reason 要带上**每条通道各自失败的原因**: 只写"全部失败"的话,
       * 运营无法判断是"第一家限流"还是"第三家协议填错" —— 而那正是
       * 排障时最需要的信息。故把 attempts 折叠成一行摘要。
       *
       * 「一条都没尝试」（未配置 / 全部停用）不算 fallback —— 那说明当时
       * 根本没有远程可用，不是一次失败后的降级。
       */
      const summary = dispatch.attempts
        .map((a) => `${a.channelName}(${a.protocol}): ${a.reason ?? (a.ok ? '成功' : '失败')}`)
        .join('; ');
      const reason = [dispatch.unavailableReason, summary].filter(Boolean).join(' — ');

      /*
       * 一条能收遮罩的通道都没有 → 42205。
       *
       * 必须排在下面的能力策略判定之前: 局部重绘同时是「不允许本地产物」和
       * 「需要遮罩」，先判 42204 会让运营以为「没配通道」，实际是配了通道
       * 但协议不对 —— 两种问题的处置完全不同（加线路 vs 换成 openai 协议）。
       */
      if (maskPath && maskCapableChannels === 0) {
        this.log.warn(`${capability}: 全部通道的协议都不支持遮罩重绘 — ${reason}`);
        return this.failWithoutChannel(
          capability, params, route, startedAt,
          reason || '当前通道不支持遮罩重绘，请在后台改用 openai 协议的图像线路',
          '42205',
        );
      }

      if (!allowLocal) {
        this.log.warn(`${capability}: 无可用真实模型通道, 按能力策略判失败 (不交付本地产物) — ${reason}`);
        return this.failWithoutChannel(
          capability, params, route, startedAt,
          reason || '未配置可用的图像模型通道',
        );
      }

      const fallback = dispatch.attempts.length > 0;
      this.log.warn(`${capability}: 无可用真实模型通道, 回落本地算法 — ${reason}`);
      return this.runLocal(capability, inputPaths, params, route, startedAt, reason, fallback);
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
  }

  /** 该能力在云端不可用时是否允许交付本地产物 (判定集中在 capability-plugin.type) */
  private allowsLocal(capability: string): boolean {
    const def = getCapability(capability);
    // 未注册的能力不在这里拦 (generate.service 已在下单前校验), 按允许处理
    return def ? allowsLocalFallback(def) : true;
  }

  /**
   * 该能力不允许交付本地产物时: 记一条失败调用, 然后抛 NoModelChannelError。
   *
   * 必须写 ModelCallLog —— 后台「模型调用记录」是唯一能回答「为什么这次没出图、
   * 是哪条线路报了什么错」的地方; 只抛异常的话，任务卡上一句「生成失败」什么也没说。
   */
  private async failWithoutChannel(
    capability: string,
    params: Record<string, any>,
    route: CapabilityRoute,
    startedAt: number,
    reason: string,
    errorCode: '42204' | '42205' = '42204',
  ): Promise<never> {
    await this.callLogger.logFailure({
      capability,
      params,
      prompt: buildPromptFor(capability, params),
      route,
      source: 'gateway',
      // 模态固定为 image —— 本路由器只服务图像能力
      modality: 'image',
      durationMs: Date.now() - startedAt,
      fallback: false,
      reason,
      // 与 generate.service 落库的任务错误码一致, 便于两处对账
      errorCode,
    });
    // 错误类型决定 generate.service 落哪个码: 42205 必须是 MaskUnsupportedError,
    // 否则会被当成「没通道」写成 42204, 两种问题的处置方式不同。
    if (errorCode === '42205') throw new MaskUnsupportedError(reason);
    throw new NoModelChannelError(reason);
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