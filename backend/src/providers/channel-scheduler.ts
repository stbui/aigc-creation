import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { gatewayConfigOf } from './gateway.config';
import { findVendor } from './vendors/vendor.catalog';
import type { Modality } from './modality';

/**
 * 多渠道调度器 (2026-10-20)。
 *
 * ## 它解决什么问题
 *
 * 改造前每个模态只能配**一家**厂商。那家一旦限流/挂掉/欠费, 该模态整体不可用:
 *   - 图像还能回落本地真实算法 (体验降级)
 *   - 文本与视频**没有本地兜底** → 直接失败, 用户拿不到任何东西
 *
 * 而本项目已接 5 家厂商 (优云智算/硅基流动/OpenAI/火山/MiniMax),
 * 它们本该互为备份 —— 硅基流动限流时退到优云智算, 用户完全无感。
 *
 * ## 调度语义
 *
 * 1. 按 `priority` 升序选出候选通道 (数字小者先试)
 * 2. 跳过 `enabled=false` 与**处于冷却中**的通道 (熔断)
 * 3. 逐个尝试, 成功即返回; 失败则记一笔并试下一条
 * 4. 连续失败累计到阈值 → 该通道进入冷却 (冷却时长可配)
 *
 * ## 为什么不用权重随机
 *
 * 权重随机 (New API 的做法) 适合「同质多渠道分摊流量」。
 * 本项目的多渠道目的是**灾备**而非分摊: 一条挂了要能确定性地切到下一条,
 * 排障时也要能说出「刚才走的是哪条」。随机会让这两个都变难。
 * 故只做顺序调度, 不引入权重 —— 少一个可调项就少一个配错的可能。
 *
 * ⚠️ 若将来真的需要分摊流量, 应新增独立的 `weight` 字段并明确
 * 「同 priority 内按权重随机」, 而不是把顺序与权重混在一个数字里。
 */

/** 一次尝试的结果 (供路由层记录与决策) */
export interface ChannelAttempt<T> {
  channelId: string;
  channelName: string;
  protocol: string;
  ok: boolean;
  latencyMs: number;
  /** 失败原因 (成功时为 undefined) */
  reason?: string;
  /** 该次尝试的产出 (仅成功有) */
  value?: T;
}

/** 调度结果 */
export interface ChannelDispatch<T> {
  ok: boolean;
  /** 成功时的产出 */
  value?: T;
  /** 实际走通的通道 (成功时非空) */
  channel?: { id: string; name: string; protocol: string };
  /** 全部尝试记录 (含失败的), 供埋点与排障 */
  attempts: ChannelAttempt<T>[];
  /**
   * 无通道可用的原因 (全部在冷却 / 全部停用 / 一条都没配)。
   *
   * ⚠️ 与「尝试了但失败」区分: 前者是配置问题, 后者是通道问题,
   * 运营要采取的动作完全不同。
   */
  unavailableReason?: string;
}

/** 熔断参数 */
export interface CircuitBreakerOptions {
  /** 连续失败多少次进入冷却 */
  failThreshold: number;
  /** 冷却时长 (毫秒) */
  cooldownMs: number;
}

@Injectable()
export class ChannelScheduler {
  private readonly log = new Logger(ChannelScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 调度一次调用: 按 priority 顺序尝试各通道, 直到成功或全部失败。
   *
   * @param modality 模态 —— 决定读哪些通道
   * @param run 单次尝试的真实调用。**抛异常**即视为该通道失败。
   *            由调用方提供, 因为它才知道怎么调对应协议的 provider。
   */
  async dispatch<T>(
    modality: Modality,
    run: (channel: Channel) => Promise<T>,
  ): Promise<ChannelDispatch<T>> {
    const { channels, unavailableReason } = await this.readChannels(modality);
    if (channels.length === 0) {
      return {
        ok: false,
        attempts: [],
        unavailableReason: unavailableReason ?? `${modality} 模态未配置任何模型通道`,
      };
    }

    const cfg = gatewayConfigOf(modality);
    const breaker: CircuitBreakerOptions = {
      // 阈值与冷却时长取该模态的超时配置同源量级, 不另立一套默认值
      failThreshold: 3,
      cooldownMs: Math.max(30_000, cfg.pollMs * 5),
    };

    const attempts: ChannelAttempt<T>[] = [];
    const now = Date.now();

    for (const ch of channels) {
      // 熔断中 → 跳过, 不浪费一次必然失败的调用
      if (ch.cooldownUntil && ch.cooldownUntil.getTime() > now) {
        attempts.push({
          channelId: ch.id,
          channelName: ch.name,
          protocol: ch.protocol,
          ok: false,
          latencyMs: 0,
          reason: `通道冷却中 (至 ${ch.cooldownUntil.toISOString()})`,
        });
        continue;
      }

      const startedAt = Date.now();
      try {
        const value = await run(ch);
        const latencyMs = Date.now() - startedAt;
        attempts.push({
          channelId: ch.id,
          channelName: ch.name,
          protocol: ch.protocol,
          ok: true,
          latencyMs,
          value,
        });
        // 成功 → 清零失败计数并退出冷却 (通道恢复了)
        await this.markSuccess(ch.id);
        this.log.log(
          `${modality}: 通道 ${ch.name} (${ch.protocol}) 成功 ${latencyMs}ms`,
        );
        return {
          ok: true,
          value,
          channel: { id: ch.id, name: ch.name, protocol: ch.protocol },
          attempts,
        };
      } catch (e) {
        const latencyMs = Date.now() - startedAt;
        const reason = (e as Error).message ?? String(e);
        attempts.push({
          channelId: ch.id,
          channelName: ch.name,
          protocol: ch.protocol,
          ok: false,
          latencyMs,
          reason,
        });
        this.log.warn(`${modality}: 通道 ${ch.name} (${ch.protocol}) 失败 ${latencyMs}ms — ${reason}`);
        await this.markFailure(ch.id, breaker);
        // 继续试下一条
      }
    }

    return {
      ok: false,
      attempts,
      unavailableReason: `${modality} 模态的全部 ${channels.length} 条通道均失败`,
    };
  }

  /**
   * 读出该模态的候选通道 (按 priority 升序)。
   *
   * ⚠️ **惰性迁移**在这里: 表里没有该模态任何通道时, 用存量单通道配置
   * (`gateway.<模态>.*`) 合成一条。这让存量部署**零配置**获得多渠道能力 ——
   * 直接返回空列表会让所有生成立刻失败, 那是上线即事故。
   *
   * 合成只在读时发生, **不落库**: 运营在后台加第二条通道时才把这条固化
   * (见 ChannelRepository.materialize)。这样未使用多渠道的部署不会
   * 因为读一次就多出一行。
   */
  private async readChannels(
    modality: Modality,
  ): Promise<{ channels: Channel[]; unavailableReason?: string }> {
    const rows = await this.prisma.modelChannel.findMany({
      where: { modality },
      orderBy: { priority: 'asc' },
    });

    if (rows.length > 0) {
      /*
       * ⚠️ 必须在**查到全量行之后**再过滤 enabled，不能把 enabled 写进 where：
       * 全部停用时 where 会返回空数组，下面的合成分支就会被误触发，
       * 于是「停用全部线路」反而让旧单通道配置复活 —— 最难察觉的一类事故。
       */
      const enabled = rows.filter((r) => r.enabled);
      if (enabled.length === 0) {
        return {
          channels: [],
          unavailableReason: `${modality} 模态的 ${rows.length} 条通道均已停用`,
        };
      }
      return { channels: enabled.map((r) => this.toChannel(r)) };
    }

    // 表里没有 → 用存量单通道配置合成
    const cfg = gatewayConfigOf(modality);
    if (!cfg.enabled) {
      return { channels: [], unavailableReason: `${modality} 模态未配置任何模型通道` };
    }
    /*
     * 合成通道的名字带上**厂商展示名**（2026-10-21）。
     *
     * 名字会进入每一次失败的 reason（`${channelName}(${protocol}): ...`），而
     * 排障时要回答的正是「刚才走的是哪一家」。只写 `image 通道` 时，运营
     * 拿到的错误里没有厂商身份，只能再去翻环境变量才知道配的是谁。
     * cfg.provider 存的是厂商标识（历史别名 modelverse 也能查到目录项）。
     */
    const vendorLabel = findVendor(cfg.provider)?.label;
    return {
      channels: [
        {
          id: `synthetic:${modality}`,
          name: `${vendorLabel ? `${vendorLabel} · ` : ''}${modality} 通道 (迁移自单通道配置)`,
          protocol: cfg.provider,
          baseUrl: cfg.baseUrl,
          token: cfg.token,
          model: cfg.model,
          priority: 0,
          enabled: true,
        },
      ],
    };
  }

  /** 成功: 清零失败计数, 退出冷却 */
  private async markSuccess(id: string): Promise<void> {
    // 合成通道 (未落库) 没有 id 可更新 —— 跳过, 不影响调度正确性
    if (id.startsWith('synthetic:')) return;
    try {
      await this.prisma.modelChannel.update({
        where: { id },
        data: { failCount: 0, cooldownUntil: null, lastSuccessAt: new Date() },
      });
    } catch (e) {
      // 健康状态更新失败不影响本次产出 —— 它只是观测数据
      this.log.warn(`更新通道健康状态失败 (已忽略) — ${(e as Error).message}`);
    }
  }

  /** 失败: 累计失败数, 达阈值则进冷却 */
  private async markFailure(id: string, breaker: CircuitBreakerOptions): Promise<void> {
    if (id.startsWith('synthetic:')) return;
    try {
      const row = await this.prisma.modelChannel.findUnique({
        where: { id },
        select: { failCount: true },
      });
      const next = (row?.failCount ?? 0) + 1;
      const cooldown = next >= breaker.failThreshold ? new Date(Date.now() + breaker.cooldownMs) : null;
      await this.prisma.modelChannel.update({
        where: { id },
        data: {
          failCount: next,
          lastFailureAt: new Date(),
          // 达阈值才设冷却; 未达则清掉 (避免残留旧的冷却时间)
          cooldownUntil: cooldown,
        },
      });
    } catch (e) {
      this.log.warn(`更新通道健康状态失败 (已忽略) — ${(e as Error).message}`);
    }
  }

  /** DB 行 → 调度用的通道形状 */
  private toChannel(r: {
    id: string;
    name: string;
    protocol: string;
    baseUrl: string;
    token: string;
    model: string;
    priority: number;
    enabled: boolean;
    cooldownUntil: Date | null;
  }): Channel {
    return {
      id: r.id,
      name: r.name,
      protocol: r.protocol,
      baseUrl: r.baseUrl,
      token: r.token,
      model: r.model,
      priority: r.priority,
      enabled: r.enabled,
      cooldownUntil: r.cooldownUntil ?? undefined,
    };
  }
}

/** 调度器看到的通道形状 (不依赖 Prisma 类型, 便于测试) */
export interface Channel {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  token: string;
  model: string;
  priority: number;
  enabled: boolean;
  /** 冷却截止时间; 存在且未过期 → 该通道被跳过 */
  cooldownUntil?: Date;
}
