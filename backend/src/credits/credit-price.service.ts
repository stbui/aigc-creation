import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CAPABILITIES, defaultCreditCostOf, getCapability } from '../capabilities/capability.registry';
import { AppError } from '../common/app.exception';

/**
 * 能力消耗价的运行时解析 (commerce-design.md §4.4)。
 *
 * 优先级链 (三层, 自上而下):
 *   SystemSetting['creditPrice.<capabilityId>']  ← 后台可改, 运行时覆盖
 *     → CapabilityDef.creditCost                 ← 代码默认值, 改价要发版
 *       → 0                                      ← 兜底 (理论上已被启动断言堵死)
 *
 * ⚠️ **调用方只应通过 resolve() 取价, 不要直接读 def.creditCost** ——
 * 后台改价是本模块存在的唯一理由, 直读字段会让改价对生成链路静默失效,
 * 表现为「后台显示已保存, 用户却仍按旧价扣费」。
 *
 * **为什么有缓存**: 生成是本项目最高频的写路径, 每张生成图多查一次库不可接受。
 * 缓存 3s 意味着「后台改价后最多 3 秒生效」, 这个延迟对定价调整完全可接受。
 * 改价后调用 invalidate() 立即失效, 不必等 TTL。
 */
const CACHE_TTL_MS = 3000;

@Injectable()
export class CreditPriceService {
  private readonly logger = new Logger(CreditPriceService.name);

  /** key: `creditPrice.<capabilityId>` → 积分数 */
  private cache = new Map<string, number>();
  /** 进行中的限时免费活动覆盖的能力 id（命中即 0 积分） */
  private freeIds = new Set<string>();
  private cacheAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** 后台改价后立即失效缓存。不调也能等 TTL, 但改价应即时生效。 */
  invalidate(): void {
    this.cache.clear();
    this.freeIds.clear();
    this.cacheAt = 0;
  }

  /** setting 的 key 命名 —— 与后台设置项一一对应 */
  static keyOf(capabilityId: string): string {
    return `creditPrice.${capabilityId}`;
  }

  /**
   * 解析某能力的当前生效消耗价。
   *
   * 一次查全部覆盖项后在内存里匹配: 15 项能力逐个查库是 N+1,
   * 而这里本来就要一次 findMany 才能填满缓存。
   */
  async resolve(capabilityId: string): Promise<number> {
    if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
      await this.refresh();
    }
    /*
     * 限时免费优先于一切定价来源：活动期内这项能力就是 0 积分。
     *
     * 放在「后台覆盖价」之前是有意的 —— 运营把价从 10 改成 8、同时开了
     * 限时免费，用户端只能是 0；若反过来先取覆盖价，活动就会静默失效。
     * 缓存 TTL 同时管住活动起止：到点后最多 3 秒自动恢复原价，
     * 不需要调度任务去「把价格改回来」（那类补偿逻辑最容易漏）。
     */
    if (this.freeIds.has(capabilityId)) return 0;
    return this.cache.get(CreditPriceService.keyOf(capabilityId)) ?? defaultCreditCostOf(capabilityId);
  }

  /** 批量解析 (前端下发 / 后台展示用), 一次查库 */
  async resolveAll(): Promise<Record<string, number>> {
    await this.refresh();
    const out: Record<string, number> = {};
    for (const c of CAPABILITIES) {
      out[c.id] = this.freeIds.has(c.id)
        ? 0
        : this.cache.get(CreditPriceService.keyOf(c.id)) ?? defaultCreditCostOf(c.id);
    }
    return out;
  }

  /**
   * 后台展示用: 每个能力的生效价 + 来源 + 是否被覆盖。
   *
   * `source` 必须返回给运营看 —— 改价页上「这个价来自代码还是来自后台」
   * 不明示, 就会出现"我改了但没生效"时无法判断该改哪一层。
   */
  async adminList(): Promise<
    Array<{
      capabilityId: string;
      capabilityName: string;
      cost: number;
      source: 'setting' | 'registry' | 'campaign';
      overridden: boolean;
      registryDefault: number;
      /** 是否被进行中的限时免费活动覆盖 */
      freeCampaign: boolean;
    }>
  > {
    await this.refresh();
    return CAPABILITIES.map((c) => {
      const key = CreditPriceService.keyOf(c.id);
      const settingValue = this.cache.get(key);
      const overridden = settingValue !== undefined;
      const free = this.freeIds.has(c.id);
      return {
        capabilityId: c.id,
        capabilityName: c.name,
        // 生效价 = 用户此刻实扣的价，活动命中即为 0
        cost: free ? 0 : overridden ? settingValue : defaultCreditCostOf(c.id),
        /*
         * source 必须能区分 campaign：运营看到「生效价 0 / 来源 registry」
         * 会以为代码写错了，而真相是一个进行中的限时免费活动。
         */
        source: free ? 'campaign' : overridden ? 'setting' : 'registry',
        overridden,
        registryDefault: defaultCreditCostOf(c.id),
        freeCampaign: free,
      };
    });
  }

  /**
   * 后台写入覆盖价。
   *
   * ⚠️ 校验不可省: capabilityId 来自请求体, 不校验就能往库里写
   * `creditPrice.不存在的id`, 这类脏键永远不被消费却占着 setting 表,
   * 且会让「后台看到的配置」与「实际计费」再次分叉。
   */
  async setPrice(capabilityId: string, cost: number): Promise<{ capabilityId: string; cost: number }> {
    const def = getCapability(capabilityId);
    if (!def) throw new AppError(40001, `未知能力: ${capabilityId}`, 400);
    if (!Number.isInteger(cost) || cost < 0) {
      throw new AppError(40001, '消耗价必须是非负整数', 400);
    }

    const key = CreditPriceService.keyOf(capabilityId);
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (existing) {
      await this.prisma.systemSetting.update({
        where: { key },
        data: { value: String(cost), updatedBy: 'admin' },
      });
    } else {
      await this.prisma.systemSetting.create({
        data: { key, value: String(cost), updatedBy: 'admin' },
      });
    }

    this.invalidate();
    this.logger.log(`消耗价已更新: ${capabilityId} (${def.name}) = ${cost} 积分`);
    return { capabilityId, cost };
  }

  /** 清掉某能力的覆盖价, 回落到 registry 默认值 */
  async resetPrice(capabilityId: string): Promise<{ capabilityId: string; cost: number }> {
    const def = getCapability(capabilityId);
    if (!def) throw new AppError(40001, `未知能力: ${capabilityId}`, 400);
    await this.prisma.systemSetting
      .delete({ where: { key: CreditPriceService.keyOf(capabilityId) } })
      .catch(() => undefined);
    this.invalidate();
    this.logger.log(`消耗价已回落默认值: ${capabilityId} (${def.name})`);
    return { capabilityId, cost: defaultCreditCostOf(capabilityId) };
  }

  private async refresh(): Promise<void> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'creditPrice.' } },
      select: { key: true, value: true },
    });

    const next = new Map<string, number>();
    for (const r of rows) {
      // 库里存的是字符串, 手工改过库可能塞进非数字 —— 跳过而不是让整表解析失败
      const n = Number(r.value);
      if (Number.isFinite(n) && n >= 0) next.set(r.key, Math.floor(n));
    }

    /*
     * 限时免费活动与覆盖价在**同一次刷新**里取，保证两者不会出现
     * 「价格刷新了、免费名单还是上一轮」的半新半旧状态。
     */
    const now = new Date();
    const campaigns = await this.prisma.campaign.findMany({
      where: { type: 'limited_free', status: 'active', startAt: { lte: now }, endAt: { gte: now } },
      select: { payload: true },
    });
    const free = new Set<string>();
    for (const c of campaigns) {
      try {
        const payload = JSON.parse(c.payload || '{}') as { capabilityIds?: string[] };
        for (const id of payload.capabilityIds ?? []) free.add(id);
      } catch {
        // 手的 payload 解析失败不能拖垮定价 —— 跳过这一个活动
      }
    }

    this.cache = next;
    this.freeIds = free;
    this.cacheAt = Date.now();
  }
}