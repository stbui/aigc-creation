import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from './app.exception';
import {
  SETTING_DEFS,
  findSettingDef,
  parseSettingValue,
  type SettingDef,
  type SettingValue,
} from './setting-defs';

/**
 * 系统设置的运行时读取 —— **业务侧读设置值只走这里**。
 *
 * 放在 `common/` 而不是 `admin/`，是因为上传校验、移动端上传、生成链路
 * 都要读这些值；留在 admin 层会让业务模块反向依赖后台模块。
 *
 * 优先级链 (与模型通道配置同构):
 *   代码默认值 (setting-defs.ts)  →  DB 运行时覆盖 (SystemSetting 表)
 *
 * **为什么有缓存**: 上传校验在每次上传时都要读上限，生成任务创建也要读，
 * 每读一次就查一次库不可接受。缓存 3s 意味着「后台改完最多 3 秒生效」，
 * 这个延迟对运营完全可接受；后台写入后调 `invalidate()` 立即失效。
 * 参照物是 `credit-price.service.ts` 的同一套模式。
 */
const CACHE_TTL_MS = 3000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /** key → 生效值（已按 SettingDef 归一化） */
  private cache = new Map<string, SettingValue>();
  /** key → 上次修改的操作人，供设置页显示「上次由 X 改」 */
  private actorCache = new Map<string, { updatedBy: string | null; updatedAt: Date | null }>();
  private cacheAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** 后台改设置后立即失效缓存。不调也能等 TTL，但改设置应即时生效 */
  invalidate(): void {
    this.cache.clear();
    this.actorCache.clear();
    this.cacheAt = 0;
  }

  /**
   * 读取单个设置的有效值。
   *
   * 未知键抛 404 —— 调用方传错键名时应当立刻暴露，而不是静默拿到 undefined
   * 然后在下游算出一个奇怪的值。
   */
  async get<T = SettingValue>(key: string): Promise<T> {
    const def = findSettingDef(key);
    if (!def) throw new AppError(40400, `未知设置项: ${key}`, 404);

    if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
      await this.refresh();
    }
    const cached = this.cache.get(key);
    return (cached === undefined ? def.default : cached) as T;
  }

  /** 读取数值型设置；值非法或显式留空时回落定义里的默认值 */
  async getNumber(key: string): Promise<number> {
    const def = findSettingDef(key);
    const fallback = typeof def?.default === 'number' ? def.default : 0;
    try {
      const v = await this.get<string | number | null>(key);
      if (v === null) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  /** 读取可空数值型设置；显式留空返回 null，未知/坏值回落代码默认值 */
  async getNullableNumber(key: string): Promise<number | null> {
    const def = findSettingDef(key);
    const fallback = typeof def?.default === 'number' ? def.default : null;
    try {
      const v = await this.get<string | number | null>(key);
      if (v === null || v === '') return def?.nullable ? null : fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  /** 读取布尔型设置 */
  async getBoolean(key: string): Promise<boolean> {
    const def = findSettingDef(key);
    const fallback = def?.default === true;
    try {
      const v = await this.get<string | boolean>(key);
      if (typeof v === 'boolean') return v;
      return v === 'true';
    } catch {
      return fallback;
    }
  }

  /** 一次性读全部设置项的生效值（含缓存） */
  async getAll(): Promise<Record<string, SettingValue>> {
    if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
      await this.refresh();
    }
    const out: Record<string, SettingValue> = {};
    for (const def of SETTING_DEFS) {
      const v = this.cache.get(def.key);
      out[def.key] = v === undefined ? def.default : v;
    }
    return out;
  }

  /** 某项的最后修改人 / 修改时间 */
  async getMeta(key: string): Promise<{ updatedBy: string | null; updatedAt: Date | null }> {
    if (Date.now() - this.cacheAt > CACHE_TTL_MS) {
      await this.refresh();
    }
    return this.actorCache.get(key) ?? { updatedBy: null, updatedAt: null };
  }

  /**
   * 退款规则快照。
   *
   * 三项一次读齐再交给调用方 —— 让服务层只负责「按规则判」，
   * 不必知道设置存在哪个表、键叫什么。规则在**提交那一刻**读取并冻结：
   * 运营在退款过程中改了设置，本次退款仍按提交时的规则判定。
   */
  async refundRules(): Promise<{
    windowDays: number;
    maxRatioBps: number;
    allowConsumedTask: boolean;
  }> {
    const [windowDays, maxRatioBps, allowConsumedTask] = await Promise.all([
      this.get<number>('refund.windowDays'),
      this.get<number>('refund.maxRatioBps'),
      this.get<boolean>('refund.allowConsumedTask'),
    ]);
    return { windowDays, maxRatioBps, allowConsumedTask };
  }

  /**
   * 支付基本规则快照。
   *
   * 金额设置以元展示，业务侧统一使用分；可空项表示“不限”。
   * 支付宝移动端当面付唤起允许部署环境变量强制开启（后台关闭时也可打开），
   * 便于灰度环境在不动数据库的前提下验证真实唤起链路。
   */
  async paymentRules(): Promise<PaymentRules> {
    const [
      enabled,
      productNamePrefix,
      productNameSuffix,
      minAmountYuan,
      maxAmountYuan,
      dailyLimitYuan,
      orderTtlMinutes,
      maxPendingOrders,
      cancelLimitEnabled,
      cancelWindowMode,
      cancelWindowSize,
      cancelWindowUnit,
      cancelLimitMax,
      loadBalancingStrategy,
      alipayMobilePrecreateDeepLink,
      helpImage,
      helpText,
    ] = await Promise.all([
      this.get<boolean>('payment.enabled'),
      this.get<string>('payment.productNamePrefix'),
      this.get<string>('payment.productNameSuffix'),
      this.getNumber('payment.minAmountYuan'),
      this.getNullableNumber('payment.maxAmountYuan'),
      this.getNullableNumber('payment.dailyLimitYuan'),
      this.getNumber('payment.orderTtlMinutes'),
      this.getNumber('payment.maxPendingOrders'),
      this.getBoolean('payment.cancelLimitEnabled'),
      this.get<string>('payment.cancelWindowMode'),
      this.getNumber('payment.cancelWindowSize'),
      this.get<string>('payment.cancelWindowUnit'),
      this.getNumber('payment.cancelLimitMax'),
      this.get<string>('payment.loadBalancingStrategy'),
      this.get<boolean>('payment.alipayMobilePrecreateDeepLink'),
      this.get<string>('payment.helpImage'),
      this.get<string>('payment.helpText'),
    ]);

    return {
      enabled,
      productNamePrefix,
      productNameSuffix,
      minAmountCents: yuanToCents(minAmountYuan) ?? 0,
      maxAmountCents: yuanToCents(maxAmountYuan),
      dailyLimitCents: yuanToCents(dailyLimitYuan),
      orderTtlMinutes: Math.max(1, Math.round(orderTtlMinutes)),
      maxPendingOrders: Math.max(1, Math.round(maxPendingOrders)),
      cancelLimitEnabled,
      cancelWindowMode: cancelWindowMode === 'fixed' ? 'fixed' : 'rolling',
      cancelWindowSize: Math.max(1, Math.round(cancelWindowSize)),
      cancelWindowUnit: cancelWindowUnit === 'hour' ? 'hour' : 'minute',
      cancelLimitMax: Math.max(1, Math.round(cancelLimitMax)),
      loadBalancingStrategy:
        loadBalancingStrategy === 'least-amount' ? 'least-amount' : 'round-robin',
      alipayMobilePrecreateDeepLink:
        alipayMobilePrecreateDeepLink ||
        process.env.ALIPAY_MOBILE_PRECREATE_DEEP_LINK?.trim().toLowerCase() === 'true',
      helpImage,
      helpText,
    };
  }

  /**
   * 刷新缓存：一次 findMany 覆盖全部设置项。
   *
   * 只取本模块定义的键 —— SystemSetting 表里还混着 `creditPrice.*`
   * （积分价有自己的缓存与键空间），全表扫进来再丢弃是白读。
   */
  private async refresh(): Promise<void> {
    const known = new Set(SETTING_DEFS.map((d) => d.key));
    const rows = await this.prisma.systemSetting.findMany();
    const cache = new Map<string, SettingValue>();
    const actors = new Map<string, { updatedBy: string | null; updatedAt: Date | null }>();

    for (const row of rows) {
      if (!known.has(row.key)) continue;
      const def = findSettingDef(row.key);
      if (!def) continue;
      cache.set(row.key, parseSettingValue(row.value, def));
      actors.set(row.key, { updatedBy: row.updatedBy, updatedAt: row.updatedAt });
    }

    this.cache = cache;
    this.actorCache = actors;
    this.cacheAt = Date.now();
  }

  /**
   * 解析库里的字符串值为目标类型。
   *
   * 存量数据可能格式不合法 (手工改过库), 此时回退到代码默认值 ——
   * 一个坏配置不应让整页设置加载失败。
   */
  private parseValue(raw: string, def: SettingDef): SettingValue {
    return parseSettingValue(raw, def);
  }
}

export interface PaymentRules {
  enabled: boolean;
  productNamePrefix: string;
  productNameSuffix: string;
  minAmountCents: number;
  maxAmountCents: number | null;
  dailyLimitCents: number | null;
  orderTtlMinutes: number;
  maxPendingOrders: number;
  cancelLimitEnabled: boolean;
  cancelWindowMode: 'rolling' | 'fixed';
  cancelWindowSize: number;
  cancelWindowUnit: 'minute' | 'hour';
  cancelLimitMax: number;
  loadBalancingStrategy: 'round-robin' | 'least-amount';
  alipayMobilePrecreateDeepLink: boolean;
  helpImage: string;
  helpText: string;
}

function yuanToCents(yuan: number | null): number | null {
  return yuan === null ? null : Math.round(yuan * 100);
}
