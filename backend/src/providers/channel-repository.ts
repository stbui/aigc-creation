import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { gatewayConfigOf } from './gateway.config';
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
  /** true = 这条是**未落库**的合成通道 (迁移自单通道配置) */
  synthetic: boolean;
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
   * 新增通道。
   *
   * ⚠️ **首次新增会先固化合成通道** —— 否则合成通道 (priority=0) 与
   * 新通道的 priority 会撞车, 且运营会发现自己改旧配置不再生效却不知为何。
   */
  async create(modality: Modality, input: ChannelInput): Promise<ChannelView> {
    await this.materializeIfSynthetic(modality);
    // priority 缺省 = 当前最大 + 1 (追加到末尾), 不占用已有的 0
    const max = await this.prisma.modelChannel.findFirst({
      where: { modality },
      orderBy: { priority: 'desc' },
      select: { priority: true },
    });
    const priority = input.priority ?? (max ? max.priority + 1 : 0);

    const row = await this.prisma.modelChannel.create({
      data: {
        modality,
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl ?? '',
        token: input.token ?? '',
        model: input.model ?? '',
        priority,
        enabled: input.enabled ?? true,
      },
    });
    return this.toView(row, false);
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
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.model !== undefined) data.model = input.model;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    // 仅当显式传入非空 token 才更新凭据
    if (input.token !== undefined && input.token !== '') data.token = input.token;

    const row = await this.prisma.modelChannel.update({ where: { id }, data });
    return this.toView(row, false);
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
    await this.prisma.$transaction([
      this.prisma.modelChannel.update({ where: { id: self.id }, data: { priority: otherPriority } }),
      this.prisma.modelChannel.update({ where: { id: other.id }, data: { priority: selfPriority } }),
    ]);
    return this.list(target.modality as Modality);
  }

  /**
   * 固化合成通道 (把存量单通道配置变成真行)。
   *
   * 仅在运营首次新增通道时调用 —— 见 create 的注释。
   */
  private async materializeIfSynthetic(modality: Modality): Promise<void> {
    const count = await this.prisma.modelChannel.count({ where: { modality } });
    if (count > 0) return;

    const synthetic = this.synthesize(modality);
    if (!synthetic) return;

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
    },
    synthetic: boolean,
  ): ChannelView {
    return {
      id: r.id,
      modality: r.modality as Modality,
      name: r.name,
      protocol: r.protocol,
      baseUrl: r.baseUrl,
      model: r.model,
      priority: r.priority,
      enabled: r.enabled,
      tokenMasked: r.token ? maskToken(r.token) : '',
      hasToken: Boolean(r.token),
      failCount: r.failCount,
      cooldownUntil: r.cooldownUntil?.toISOString() ?? null,
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
      synthetic,
    };
  }
}

/** 凭据脱敏: 只留首 4 与末 4 */
function maskToken(raw: string): string {
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}${'*'.repeat(Math.max(4, raw.length - 8))}${raw.slice(-4)}`;
}
