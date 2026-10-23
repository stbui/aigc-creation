import { Injectable, Logger } from '@nestjs/common';
import { OpenAiChatTextProvider } from './openai-chat-text.provider';
import { gatewayConfigOf, setGatewayConfigOverrides, invalidateGatewayConfigCache } from './gateway.config';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCallLogger } from './image-call-logger';
import { ChannelScheduler } from './channel-scheduler';
import type { TextMessage, TextProvider, TextProviderResult } from './text-provider.interface';
import type { Modality } from './modality';

/**
 * 文生文路由器 —— 与 CapabilityRouterProvider 同构的「模态路由器」。
 *
 * 为什么本轮不把文本能力塞进 CapabilityRouterProvider:
 * 后者的返回类型是 `ImageProviderResult { buffer, format }`, 文本无处安放
 * (把正文编码成 UTF-8 字节再在 generate.service 解回来是纯损耗, 且会让
 * 「产出是二进制还是文本」这个判据散落到业务层)。平级一个路由器,
 * 各自只认自己的接口, 是本次三模态改造定下的分层。
 *
 * ⚠️ 本轮**只接通配置与调用入口**, 未接用户端能力卡片:
 *   - 没有 fallback 到本地 —— 文本没有「本地算法」可言, 凭空造一段模板文案
 *     会让用户以为是模型产出 (违反本项目「不把本地伪装成模型结果」的既有约定)
 *   - 未写 ModelCallLog —— 该表结构是图像专用 (outputBytes/width/height),
 *     要记文本 token 用量需先加 modality 字段, 属于下一批 schema 变更
 * 上述两点在接用户端能力前必须补齐, 否则会出现无法排障的暗箱。
 */
@Injectable()
export class TextCapabilityRouter implements TextProvider {
  private readonly log = new Logger(TextCapabilityRouter.name);
  private readonly openaiChat = new OpenAiChatTextProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly callLogger: ImageCallLogger,
    private readonly scheduler: ChannelScheduler,
  ) {
    // 启动时先拉一次, 让首个请求不必等这次查询
    void this.refreshConfig();
  }

  async generate(
    capability: string,
    messages: TextMessage[],
    params: Record<string, any>,
  ): Promise<TextProviderResult> {
    await this.refreshConfig();
    const startedAt = Date.now();
    const prompt = messages.map((m) => m.content).join('\n').slice(0, 500);

    /*
     * 不用全局 `cfg.enabled` 拦截：表里有线路时，旧的 gateway.text.* 为空
     * 也要走线路。没有可用线路由调度器返回 unavailableReason，下面统一失败。
     */
    try {
      /*
       * 多渠道调度 (2026-10-20): 文本**没有本地兜底**, 故多渠道对它尤其重要 ——
       * 单通道时唯一那家挂了就是彻底失败。现在可按 priority 依次尝试多家。
       */
      const dispatch = await this.scheduler.dispatch('text', async (channel) => {
        const provider = this.pickProtocol(channel.protocol);
        // 注入通道凭据 —— 少了这步, 切到第二条通道仍用第一家的地址, 照样失败
        if ('withChannel' in provider && typeof provider.withChannel === 'function') {
          provider.withChannel({
            baseUrl: channel.baseUrl,
            token: channel.token,
            model: channel.model,
          });
        }
        return provider.generate(capability, messages, params);
      });

      if (!dispatch.ok || !dispatch.value) {
        const summary = dispatch.attempts
          .map((a) => `${a.channelName}(${a.protocol}): ${a.reason ?? (a.ok ? '成功' : '失败')}`)
          .join('; ');
        throw new Error([dispatch.unavailableReason, summary].filter(Boolean).join(' — '));
      }

      const r = dispatch.value;
      const used = dispatch.channel!;
      this.log.log(`${capability}: 文生文通道成功 (${used.name}/${used.protocol} ${r.model ?? ''})`);
      // ⚠️ 埋点: 2026-10-20 之前文本通道**不写** ModelCallLog ——
      // 那意味着「文本调用在记录页完全不可见」, 排障时无法区分
      // 「没调用过」与「调用了但没记录」。现在补上, modality 标 'text'。
      await this.callLogger.logSuccess({
        capability,
        params,
        prompt,
        route: 'remote',
        source: 'gateway',
        modality: 'text',
        // 模型名取实际走通的那条通道 (多渠道下各家模型名不同)
        model: r.model ?? used.protocol,
        gatewayTaskId: r.taskId,
        durationMs: Date.now() - startedAt,
        // 文本产出无字节, 用文本长度近似 outputBytes (该列语义是产出大小)
        buffer: Buffer.from(r.text ?? '', 'utf-8'),
      });
      return r;
    } catch (e) {
      const reason = (e as Error).message ?? String(e);
      this.log.warn(`${capability}: 文生文通道失败 — ${reason}`);
      await this.callLogger.logFailure({
        capability,
        params,
        prompt,
        route: 'remote',
        source: 'gateway',
        modality: 'text',
        durationMs: Date.now() - startedAt,
        reason,
      });
      // ⚠️ 不回落: 文本没有本地实现。抛出去让调用方如实呈现失败。
      throw e;
    }
  }

  /**
   * 协议 → provider 实现。
   *
   * ⚠️ 未知协议**显式抛错**而非静默当 openai-chat 处理 —— 与图像侧同理由:
   * 静默兜底会把「协议填错」变成 404, 运营在界面上看不出来。
   */
  private pickProtocol(protocol: string): TextProvider {
    switch (protocol) {
      case 'openai-chat':
        return this.openaiChat;
      default:
        throw new Error(
          `未知文生文协议 "${protocol}"。可用: openai-chat（在后台「模型配置」页选择文生文厂商预设）`,
        );
    }
  }

  /** 拉取后台配置覆盖值并注入 gateway.config; 失败不阻断生成 */
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

  /** 供后台保存配置后立即失效缓存 */
  invalidate(): void {
    invalidateGatewayConfigCache();
  }

  /** 当前路由表快照 (按模态, 供后台展示真实来源) */
  routingSnapshot(modality: Modality = 'text'): { effective: 'gateway' | 'off' } {
    const cfg = gatewayConfigOf(modality);
    return { effective: cfg.enabled ? 'gateway' : 'off' };
  }
}