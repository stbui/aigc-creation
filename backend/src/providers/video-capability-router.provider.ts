import { Injectable, Logger } from '@nestjs/common';
import { MinimaxVideoProvider } from './minimax-video.provider';
import { gatewayConfigOf, setGatewayConfigOverrides, invalidateGatewayConfigCache } from './gateway.config';
import { buildPromptFor } from './gateway-prompt';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCallLogger } from './image-call-logger';
import { GatewayUnavailableError } from './gateway.types';
import type { VideoProvider, VideoOutcome } from './unified/unified.provider';

/**
 * 视频路由器 —— 视频模态的统一通道入口 (2026-10-20)。
 *
 * ## 与图像路由器的关键差异: **没有本地兜底**
 *
 * 图像有 Jimp 本地算法, 远程失败可以回落, 用户至少拿到一张图。
 * 视频**没有本地算法** —— 本地不存在"生成一段视频"这回事。
 * 编一段占位素材当视频产出, 会让用户以为模型产出了成品
 * (违反本项目「不把本地伪装成模型结果」的既有约定)。
 *
 * 故视频失败即失败, 如实抛错 —— 由 generate.service 记为任务失败。
 * 这也是能力定义里 `image_to_video` 不声明 localImpl 的原因
 * (校验器只对 image 模态强制要求本地兜底)。
 *
 * ## 路由决策
 *
 * 与图像侧同构: route=local 也不适用 (无本地实现), 直接走远程;
 * 通道未配置则明确报错, 不静默产出占位物。
 */
@Injectable()
export class VideoCapabilityRouter implements VideoProvider {
  private readonly log = new Logger(VideoCapabilityRouter.name);
  private readonly minimax = new MinimaxVideoProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly callLogger: ImageCallLogger,
  ) {
    // 启动时先拉一次, 让首个请求不必等这次查询
    void this.refreshConfig();
  }

  async generate(
    capability: string,
    inputPaths: string[],
    params: Record<string, any>,
  ): Promise<VideoOutcome> {
    await this.refreshConfig();

    const cfg = gatewayConfigOf('video');
    const startedAt = Date.now();
    const prompt = buildPromptFor(capability, params);

    if (!cfg.enabled) {
      // ⚠️ 明确失败而非回落: 视频没有本地兜底, 编一段占位物比失败更糟
      await this.callLogger.logFailure({
        capability,
        params,
        prompt,
        route: 'auto',
        source: 'gateway',
        modality: 'video',
        durationMs: Date.now() - startedAt,
        reason: '视频通道未配置（基址与令牌均为空）',
      });
      throw new GatewayUnavailableError(
        '视频通道未配置',
        '请在后台「模型配置」页选择视频通道的厂商并填写基址与令牌',
      );
    }

    try {
      const provider = this.pickProtocol(cfg.provider);
      const r = await provider.generate(capability, inputPaths, params, prompt);
      this.log.log(`${capability}: 视频通道成功 (${cfg.provider} ${r.taskId ?? '-'} ${r.model ?? ''})`);
      await this.callLogger.logSuccess({
        capability,
        params,
        prompt,
        route: 'remote',
        source: 'gateway',
        model: r.model ?? cfg.model,
        gatewayTaskId: r.taskId,
        durationMs: Date.now() - startedAt,
        modality: 'video',
        buffer: r.buffer,
      });
      return r;
    } catch (e) {
      const reason = (e as Error).message ?? String(e);
      this.log.warn(`${capability}: 视频通道失败 — ${reason}`);
      await this.callLogger.logFailure({
        capability,
        params,
        prompt,
        route: 'remote',
        source: 'gateway',
        modality: 'video',
        durationMs: Date.now() - startedAt,
        reason,
      });
      // ⚠️ 不回落: 视频没有本地实现。抛出去让 generate.service 记为任务失败。
      throw e;
    }
  }

  /**
   * 协议 → provider 实现。
   *
   * ⚠️ 未知协议**显式抛错**而非静默当 minimax-video 处理 —— 与图像侧同理由:
   * 静默兜底会把「协议填错」变成 404, 运营在界面上看不出来。
   */
  private pickProtocol(protocol: string) {
    switch (protocol) {
      case 'minimax-video':
        return this.minimax;
      default:
        throw new Error(
          `未知视频通道协议 "${protocol}"。可用: minimax-video` +
            `（在后台「模型配置」页选择视频通道的厂商预设）`,
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
}
