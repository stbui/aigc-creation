import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeBaseUrl } from './base-url';
import { gatewayConfigOf } from './gateway.config';
import { protocolSupports } from './vendors/vendor.presets';
import type { Modality } from './modality';

/**
 * 多渠道仓库 (2026-10-20)。
 *
 * ## 职责边界
 *
 * ChannelScheduler 只负责「按顺序试」, 本类负责「通道从哪来、怎么改」:
 *   - 读: 合成存量单通道配置 (惰性迁移)
 *   - 写: 增删改通道、固化合成通道、重排 priority
 *
 * ## 为什么合成通道不落库
 *
 * 存量部署只有一套 `gateway.<模态>.*` 配置。上线多渠道后若直接在库里
 * 造一行, 会出现「我没配过却多出一条通道」的困惑, 且它与旧配置形成
 * **两个真相源** (改旧配置不生效, 因为调度读的是表)。
 *
 * 故: 读时合成 (只进内存), **仅在运营显式保存时才固化**。
 * 固化会把合成通道变成真行, 此后旧配置键不再参与调度 —— 这个切换点
 * 必须是运营主动触发的, 不能是读一次就悄悄发生。
 */

/** 下发给前端的通道形状 (token 脱敏) */
export interface ChannelView {
  id: string;
  modality: Modality;
  name: string;
  protocol: string;
  baseUrl: string;
  model: string;
  priority: number;
  enabled: boolean;
  /** 凭据脱敏展示 (如 `sk-1***abcd`); 未配置为空串 */
  tokenMasked: string;
  /** 是否已配置凭据 (不回显明文, 前端据此显示「已配置」) */
  hasToken: boolean;
  failCount: number;
  cooldownUntil: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** 该 (模态, 协议) 在本项目是否有实现; false 的线路一旦启用就会必然失败 */
  protocolKnown: boolean;
  /** 最近一次配置更新时间; 合成通道为 null */
  updatedAt: string | null;
  /** true = 这条是**未落库**的合成通道 (迁移自单通道配置) */
  synthetic: boolean;
}

/** 某模态的调度来源与线路汇总 */
export type ChannelDispatchSource = 'channels' | 'legacy' | 'none';

export interface ChannelSnapshot {
  modality: Modality;
  /** channels=按线路表调度 / legacy=沿用旧版单通道配置 / none=未接入 */
  source: ChannelDispatchSource;
  total: number;
  enabledCount: number;
  /** 启用 + 不在冷却 + 协议已实现 */
  availableCount: number;
  coolingCount: number;
  unsupportedCount: number;
  channels: ChannelView[];
}

/** 新增/更新通道的入参 */
export interface ChannelInput {
  name: string;
  protocol: string;
  baseUrl?: string;
  token?: string;
  model?: string;
  priority?: number;
  enabled?: boolean;
  /** 显式清除凭据 (与 token 互斥) */
  clearToken?: boolean;
}

@Injectable()
export class ChannelRepository {
  private readonly log = new Logger(ChannelRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 列出某模态的全部通道 (含合成通道), 按 priority 升序 */
  async list(modality: Modality): Promise<ChannelView[]> {
    const rows = await this.prisma.modelChannel.findMany({
      where: { modality },
      orderBy: { priority: 'asc' },
    });
    if (rows.length === 0) {
      const synthetic = this.synthesize(modality);
      return synthetic ? [synthetic] : [];
    }
    return rows.map((r) => this.toView(r, false));
  }

  /**
   * 某模态的完整调度快照 —— 页面「我在按什么调度」的唯一事实源。
   *
   * ⚠️ `source` 的判定顺序不能颠倒: 表里有行就是 `channels`，
   * **即使全部停用也不能回落成 legacy**。否则运营停用全部线路后，
   * 旧配置会悄悄复活 —— 那是最难察觉的一类配置事故。
   */
  async snapshot(modality: Modality): Promise<ChannelSnapshot> {
    const rows = await this.prisma.modelChannel.findMany({
      where: { modality },
      orderBy: { priority: 'asc' },
    });

    if (rows.length > 0) {
      return this.summarize(modality, 'channels', rows.map((r) => this.toView(r, false)));
    }

    const synthetic = this.synthesize(modality);
    return this.summarize(modality, synthetic ? 'legacy' : 'none', synthetic ? [synthetic] : []);
  }

  private summarize(
    modality: Modality,
    source: ChannelDispatchSource,
    channels: ChannelView[],
  ): ChannelSnapshot {
    const now = Date.now();
    const cooling = (c: ChannelView) => Boolean(c.cooldownUntil && Date.parse(c.cooldownUntil) > now);
    return {
      modality,
      source,
      total: channels.length,
      enabledCount: channels.filter((c) => c.enabled).length,
      // 没有 baseUrl 的线路即使启用也不可能调用成功，不计入可用
      availableCount: channels.filter(
        (c) => c.enabled && !cooling(c) && c.protocolKnown && Boolean(c.baseUrl),
      ).length,
      coolingCount: channels.filter(cooling).length,
      unsupportedCount: channels.filter((c) => !c.protocolKnown).length,
      channels,
    };
  }

  /**
   * 新增通道。
   *
   * ⚠️ **首次新增会先固化合成通道** —— 否则合成通道 (priority=0) 与
   * 新通道的 priority 会撞车, 且运营会发现自己改旧配置不再生效却不知为何。
   */
  async create(modality: Modality, input: ChannelInput): Promise<ChannelView> {
    const { channel } = await this.createWithMaterialize(modality, input);
    return channel;
  }

  /**
   * 创建线路，并把「首次新增前固化旧配置」与「创建新线路」放在同一事务里。
   *
   * 不做事务的话，创建失败会留下一条已固化的旧配置 —— 调度来源从
   * legacy 悄悄变成 channels，而运营什么也没保存成功。行为上数据没丢，
   * 但页面会显示「已切换」，是最难解释的那类半成功。
   */
  async createWithMaterialize(
    modality: Modality,
    input: ChannelInput,
  ): Promise<{ channel: ChannelView; materialized: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      let materialized = false;
      const count = await tx.modelChannel.count({ where: { modality } });
      if (count === 0) {
        const synthetic = this.synthesize(modality);
        if (synthetic) {
          const cfg = gatewayConfigOf(modality);
          await tx.modelChannel.create({
            data: {
              modality,
              name: `${modality} 通道 (迁移自单通道配置)`,
              protocol: cfg.provider,
              baseUrl: cfg.baseUrl,
              token: cfg.token,
              model: cfg.model,
              priority: 0,
              enabled: true,
            },
          });
          materialized = true;
          this.log.log(`${modality} 模态的存量单通道配置已固化为多渠道首条`);
        }
      }

      /*
       * priority 缺省 = 当前最大 + 1（追加到末尾）。
       * 并发新增可能撞 (modality, priority) 唯一约束，故冲突时重算一次再试；
       * 重试仍失败就向上抛，由 service 转成 409，而不是返回一个「看起来成功」的假通道。
       */
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const max = await tx.modelChannel.findFirst({
          where: { modality },
          orderBy: { priority: 'desc' },
          select: { priority: true },
        });
        const priority = input.priority ?? (max ? max.priority + 1 : 0);
        try {
          const row = await tx.modelChannel.create({
            data: {
              modality,
              name: input.name,
              protocol: input.protocol,
              // 写侧统一归一化: 尾部 /v1 会被协议层再补一次, 拼成 /v1/v1/... (必然 404)
              baseUrl: normalizeBaseUrl(input.baseUrl ?? ''),
              token: input.token ?? '',
              model: input.model ?? '',
              priority,
              enabled: input.enabled ?? true,
            },
          });
          return { channel: this.toView(row, false), materialized };
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2002' || attempt === 2) throw e;
        }
      }
      throw new Error('创建通道失败：优先级冲突');
    });
  }

  /**
   * 更新通道。
   *
   * ⚠️ token **留空 = 保持原值** (与 ModelChannelConfig 的凭据约定一致)。
   * 若把留空当成"清空", 运营每次改个名字就会把密钥抹掉。
   */
  async update(id: string, input: Partial<ChannelInput>): Promise<ChannelView> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.protocol !== undefined) data.protocol = input.protocol;
    if (input.baseUrl !== undefined) data.baseUrl = normalizeBaseUrl(input.baseUrl);
    if (input.model !== undefined) data.model = input.model;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    /*
     * 凭据语义（与 ModelChannelConfig 一致）：
     *   未传 / 空串 → 保持原值（运营改个名字不该把密钥抹掉）
     *   非空        → 更新
     *   clearToken  → 显式清空（与上面两条互斥，由 service 校验）
     */
    if (input.clearToken) data.token = '';
    else if (input.token !== undefined && input.token !== '') data.token = input.token;

    const row = await this.prisma.modelChannel.update({ where: { id }, data });
    return this.toView(row, false);
  }

  /** 取原始行（含明文令牌）—— 仅供服务端测试与内部逻辑，绝不直接下发前端 */
  async getRaw(id: string) {
    return this.prisma.modelChannel.findUnique({ where: { id } });
  }

  /** 删除通道 */
  async remove(id: string): Promise<void> {
    await this.prisma.modelChannel.delete({ where: { id } });
  }

  /**
   * 把某条通道上/下移一位 (priority 交换)。
   *
   * ⚠️ 用**交换**而不是"重排全部": 后者要把该模态所有行 rewrite 一遍,
   * 中途失败会留下空洞或重复 priority (而 priority 在模态内唯一)。
   */
  async move(id: string, dir: 'up' | 'down'): Promise<ChannelView[]> {
    // 先拿到这条通道属于哪个模态 —— 排序必须**限定在同模态内**:
    // 跨模态排会把 image 的 priority 与 video 的混在一起算下标,
    // 而 priority 的唯一约束是 (modality, priority) 复合的,
    // 跨模态 swap 会撞唯一键 (且语义也错: 视频通道不该影响图像的顺序)。
    const target = await this.prisma.modelChannel.findUnique({
      where: { id },
      select: { modality: true },
    });
    if (!target) throw new Error('通道不存在');

    const rows = await this.prisma.modelChannel.findMany({
      where: { modality: target.modality },
      orderBy: { priority: 'asc' },
    });
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error('通道不存在');
    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= rows.length) {
      throw new Error(dir === 'up' ? '已在最前' : '已在最后');
    }
    const self = rows[idx];
    const other = rows[swapWith];
    /*
     * ⚠️ 必须**先把两个 priority 读出来存好**再更新。
     *
     * `self` 与 `other` 是同一个数组里的对象引用, 而 update 会就地改它们的
     * priority。若写成 `update(self.id, {priority: other.priority})` 之后
     * 再读 `self.priority`, 此时 self 可能已被上一条 update 改掉 ——
     * 结果两条通道拿到同一个 priority, 撞唯一约束 (modality, priority)。
     *
     * 这个坑在 SQLite 上表现为「update 抛唯一约束错误」, 在内存桩上
     * 表现为「两条都是 0」, 而两者都不报"你的代码写错了"。
     */
    const selfPriority = self.priority;
    const otherPriority = other.priority;
    /*
     * ⚠️ 交换必须**三段式**：借一个临时 priority 中转。
     *
     * `@@unique([modality, priority])` 是立即生效的唯一索引，SQLite 逐语句检查、
     * 不能延迟到事务提交时。因此「两条 update 直接互换」的第一步就会与还没让位的
     * 另一条撞车（P2002，2026-10-21 线上实证）。事务包起来也没用 ——
     * 被推迟的不是约束检查，而是提交。
     *
     * 临时值取「本模态最小 priority - 1」：`rows` 已包含该模态全部行，故必空闲；
     * 不用 0 / -1 这类固定值，避免与真实数据撞车。临时值只在事务内存在，
     * 结束时 self 落在 otherPriority，库里不会留下它。
     */
    const tempPriority = rows.reduce((min, r) => Math.min(min, r.priority), selfPriority) - 1;
    await this.prisma.$transaction([
      this.prisma.modelChannel.update({ where: { id: self.id }, data: { priority: tempPriority } }),
      this.prisma.modelChannel.update({ where: { id: other.id }, data: { priority: selfPriority } }),
      this.prisma.modelChannel.update({ where: { id: self.id }, data: { priority: otherPriority } }),
    ]);
    return this.list(target.modality as Modality);
  }

  /**
   * 固化合成通道 (把存量单通道配置变成真行)。
   *
   * 只在运营显式动作时调用（新增线路 / 页面点「转为可管理线路」）。
   * 返回 false 表示该模态已有真行、无需固化（幂等）。
   *
   * ⚠️ 固化会把当时生效的 token（可能来自环境变量）复制进 DB ——
   * 这是旧配置在固化后仍能工作的必要条件，但确认弹窗必须向运营说明。
   */
  async materialize(modality: Modality): Promise<boolean> {
    const count = await this.prisma.modelChannel.count({ where: { modality } });
    if (count > 0) return false;

    const synthetic = this.synthesize(modality);
    if (!synthetic) return false;

    const cfg = gatewayConfigOf(modality);
    await this.prisma.modelChannel.create({
      data: {
        modality,
        name: `${modality} 通道 (迁移自单通道配置)`,
        protocol: cfg.provider,
        baseUrl: cfg.baseUrl,
        token: cfg.token,
        model: cfg.model,
        priority: 0,
        enabled: true,
      },
    });
    this.log.log(`${modality} 模态的存量单通道配置已固化为多渠道首条`);
    return true;
  }

  /** 用存量单通道配置合成一条通道 (不落库) */
  private synthesize(modality: Modality): ChannelView | null {
    const cfg = gatewayConfigOf(modality);
    if (!cfg.enabled) return null;
    return {
      id: `synthetic:${modality}`,
      modality,
      name: `${modality} 通道 (迁移自单通道配置)`,
      protocol: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      priority: 0,
      enabled: true,
      tokenMasked: cfg.token ? maskToken(cfg.token) : '',
      hasToken: Boolean(cfg.token),
      failCount: 0,
      cooldownUntil: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      protocolKnown: protocolSupports(modality, cfg.provider),
      updatedAt: null,
      synthetic: true,
    };
  }

  private toView(
    r: {
      id: string;
      modality: string;
      name: string;
      protocol: string;
      baseUrl: string;
      token: string;
      model: string;
      priority: number;
      enabled: boolean;
      failCount: number;
      cooldownUntil: Date | null;
      lastSuccessAt: Date | null;
      lastFailureAt: Date | null;
      /** 桩 Prisma（验证脚本）可能不提供该字段；缺失时按 null 处理 */
      updatedAt?: Date | null;
    },
    synthetic: boolean,
  ): ChannelView {
    /*
     * 读侧归一化: 存量行可能把厂商文档里的 `/v1` 一起存了进来,
     * 协议层再补一次就是 /v1/v1/... (必然 404)。这里剥掉尾部 /v1,
     * 让这些行不必等人工重存就能恢复; 页面显示的是**实际生效**的地址,
     * 运营下次保存时会把这个值写回库里。
     */
    const baseUrl = normalizeBaseUrl(r.baseUrl);
    return {
      id: r.id,
      modality: r.modality as Modality,
      name: r.name,
      protocol: r.protocol,
      baseUrl,
      model: r.model,
      priority: r.priority,
      enabled: r.enabled,
      tokenMasked: r.token ? maskToken(r.token) : '',
      hasToken: Boolean(r.token),
      failCount: r.failCount,
      cooldownUntil: r.cooldownUntil?.toISOString() ?? null,
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
      protocolKnown: protocolSupports(r.modality as Modality, r.protocol),
      updatedAt: r.updatedAt?.toISOString() ?? null,
      synthetic,
    };
  }
}

/** 凭据脱敏: 只留首 4 与末 4 */
function maskToken(raw: string): string {
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}${'*'.repeat(Math.max(4, raw.length - 8))}${raw.slice(-4)}`;
}
