/**
 * 真实模型网关接入配置。
 *
 * 优先级链 (从高到低):
 *   1. 环境变量 GATEWAY_{MODALITY}_* / ASSET_PUBLIC_BASE —— 部署期固化, 最高优先
 *   2. ModelChannelConfig 表 —— 后台「模型配置」页写入, 改完即时生效
 *   3. channel-config.defs.ts 的代码默认值
 *
 * env 优先级最高是有意的: 容器化部署里 env 是运维的最后一道闸门,
 * 若后台能覆盖 env, 一次误点就能让线上生图静默切换通道。
 * 每项的实际来源 (env/db/default) 随读取结果一起返回, 供后台如实展示。
 *
 * ── 模态维度 (2026-10-20) ────────────────────────────────────────────
 * 配置按模态 (text/image/video) 各自解析, 键为 gateway.<modality>.*。
 * image 模态额外支持**存量键回落**: 改造前的 gateway.* 单前缀若在 env 或 DB 里有值,
 * 而新键 gateway.image.* 三处都没有, 则读取旧键的值 —— 已存生产的配置不失效。
 *
 * 设计原则 (与接入前一致, 未因配置下沉而改变):
 *   1. **默认零配置可用** —— 不配任何项时全部能力继续走本地 Jimp 算法,
 *      行为与接入前完全一致。
 *   2. **逐能力可路由** —— 能力都能单独切到真模型, 默认 auto。
 *   3. **失败必回落** —— 网关未配置/超时/报错, 一律回落本地并记录原因。
 *
 * 缓存: 配置读多写极少, 但生成链路每任务都要读, 故加短 TTL 内存缓存
 * (默认 3s)。取值过期的唯一后果是后台改配置后最多 3 秒才生效 —— 可接受;
 * 后台保存时会主动 invalidate, 那条路径即时生效。
 */
import { CONFIG_DEFS, ROUTE_VALUES, findConfigDef, modalityPrefix, type CapabilityId } from './channel-config.defs';
import { normalizeBaseUrl } from './base-url';
import type { Modality } from './modality';
import type { CapabilityRoute } from './gateway.types';

const env = process.env;

/** 配置缓存 TTL (毫秒) */
const CACHE_TTL_MS = 3000;

function num(name: string, fallback: number): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function bool(name: string): boolean {
  const v = (env[name] ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** 单项值的实际来源, 供后台展示「这项到底被谁覆盖着」 */
export type ConfigSource = 'env' | 'db' | 'default';

/** 某模态解析后的通道配置 */
export interface ModalityConfig {
  /** 是否配置完整到可以尝试远程调用 */
  enabled: boolean;
  baseUrl: string;
  token: string;
  model: string;
  /**
   * 通道协议。含义**随模态而变**:
   *   image → openai / volcengine / minimax
   *   text  → openai-chat
   *   video → 尚未取证, 无有效取值
   * 两者路径与响应形状不同, 路由器据此选 provider 实现 —— 配错会直接调用失败。
   */
  provider: string;
  timeoutMs: number;
  pollMs: number;
  maxPolls: number;
  /**
   * 素材对外基址 (参考图回传给网关时的站内地址)。
   *
   * 跨模态共用一个值: 它描述的是**本站**的可达地址, 与请求哪个模态无关。
   * 放在每个模态的门面上是为了让 provider 只依赖 ModalityConfig 一个接口,
   * 而不必额外知道 assetBase 是共享的。
   */
  assetBase: string;
  /** 逐能力路由决策; 远程不可用时由路由器回落 */
  routeOf(capability: string): CapabilityRoute;
  /** 各项的实际来源 (env > db > default), 后台展示用 */
  sourcesOf(): Record<string, ConfigSource>;
}

/**
 * image 模态的通道配置 —— 与 image 模态完全同形。
 *
 * ⚠️ 这是**真实副本而非引用**: image 门面上必须独立冻结当前快照,
 * 否则 video 模态改配置会把已解析好的 image 配置连带弄脏 (三个模态共享
 * 同一个模块级缓存, 重复调用会互相覆盖)。
 */
export interface GatewayConfig extends ModalityConfig {}

interface RawModality {
  enabled: boolean;
  baseUrl: string;
  token: string;
  model: string;
  provider: string;
  timeoutMs: number;
  pollMs: number;
  maxPolls: number;
}

interface RawConfig {
  /** 各模态的通道参数 (不含路由与来源, 那两项全模态共享) */
  modalities: Record<Modality, RawModality>;
  assetBase: string;
  routes: Record<string, CapabilityRoute>;
  sources: Record<string, ConfigSource>;
}

/** 只读快照缓存 (模块级, 与实例无关) */
let cache: { at: number; raw: RawConfig } | null = null;

/** 供后台保存后调用, 让下一次读取立刻反映新配置 */
export function invalidateGatewayConfigCache(): void {
  cache = null;
}

/**
 * DB 覆盖值 (key → value 字符串)。
 *
 * 由调用方 (CapabilityRouterProvider / ModelConfigService) 通过
 * setGatewayConfigOverrides 注入 —— 这样本模块保持零依赖, 优先级链可在纯函数层面推理与测试。
 */
let dbOverrides: Record<string, string> = {};

export function setGatewayConfigOverrides(rows: Record<string, string>): void {
  dbOverrides = rows;
  invalidateGatewayConfigCache();
}

/** 单项解析结果 */
interface Resolved {
  value: string | number | boolean;
  source: ConfigSource;
}

/**
 * 按优先级链解析单个配置项, 含存量键回落。
 *
 * 回落规则: **新键三项全空才读旧键**。
 * 为什么要求"全空"而不是"新键不存在": 新键的 default 是空字符串,
 * 若只要新键不是 default 就停止回落, 存量 DB 里配好的 gateway.baseUrl
 * 会被新键的空默认值盖掉 —— 表现为"改造完配置突然全丢了", 极难排查。
 */
function resolveValue(key: string, sources: Record<string, ConfigSource>): Resolved {
  const def = findConfigDef(key);
  if (!def) return { value: '', source: 'default' };

  const direct = resolveOne(def);
  if (direct.source !== 'default') {
    sources[key] = direct.source;
    return direct;
  }

  // 新键无任何取值 → 尝试存量键
  if (def.legacyKey) {
    const legacyDef = findConfigDef(def.legacyKey);
    if (legacyDef) {
      const legacy = resolveOne(legacyDef);
      if (legacy.source !== 'default') {
        // ⚠️ source 仍记作 env/db, 但记在**新键**名下 ——
        // 前端按新键展示来源徽标, 若标成 "default" 运营会以为配错了。
        sources[key] = legacy.source;
        return legacy;
      }
    }
  }

  sources[key] = 'default';
  return { value: def.default, source: 'default' };
}

/** 只解析一个键 (不含回落), env > DB > 默认 */
function resolveOne(def: { key: string; envName?: string; type: string; default: string | number | boolean }): Resolved {
  // 1) 环境变量 (存在且非空才算生效)
  const envRaw = def.envName ? env[def.envName] : undefined;
  if (envRaw !== undefined && envRaw !== '') {
    return {
      value: def.type === 'number' ? num(def.envName as string, Number(def.default)) : envRaw,
      source: 'env',
    };
  }
  // 2) 后台写入的 DB 覆盖
  const raw = dbOverrides[def.key];
  if (raw !== undefined) {
    return { value: coerce(def.type, raw, def.default), source: 'db' };
  }
  // 3) 代码默认值
  return { value: def.default, source: 'default' };
}

/** 解析一份生效配置 (env > db > 默认, 含存量键回落) */
export function resolveGatewayConfig(): RawConfig {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.raw;

  const sources: Record<string, ConfigSource> = {};
  const value = (key: string) => resolveValue(key, sources).value;

  const port = env.PORT ?? '4100';
  const assetBase = (String(value('asset.publicBase')) || `http://localhost:${port}`).replace(/\/+$/, '');

  // 逐模态解析: 用 defs 声明的 default, 不在此处另写一份 ——
  // 记忆里的教训: 同一配置项有两处默认值时, 「后台看到的默认」与
  // 「实际生效的默认」会打架, 且极难定位。
  const modalities = {} as Record<Modality, RawModality>;
  for (const modality of ['text', 'image', 'video'] as Modality[]) {
    const p = modalityPrefix(modality);
    // 基址归一到厂商根域: 尾部 /v1 会被协议层再补一次, 拼成 /v1/v1/... (必然 404)。
    // 环境变量注入的值不经过后台校验, 故归一化必须在这里兜底。
    const baseUrl = normalizeBaseUrl(String(value(`${p}.baseUrl`)));

    // 开启判定: env 强制开 > DB 显式开 > (配了基址或令牌即视为开启)
    const envForced = bool(`GATEWAY_${modality.toUpperCase()}_ENABLED`);
    const dbEnabledRaw = dbOverrides[`${p}.enabled`];
    const dbForced = dbEnabledRaw === 'true' || dbEnabledRaw === '1';

    // 兜底与 CONFIG_DEFS 的 default 保持一致: 两处默认值不同会让
    // 「后台看到的默认」与「实际生效的默认」打架, 排查时极难定位。
    // 存量已存 modelverse 的配置由 pickProtocol 的历史别名分支继续兼容。
    const defProvider = CONFIG_DEFS.find((d) => d.key === `${p}.provider`)?.default ?? 'openai';

    modalities[modality] = {
      enabled: envForced || dbForced || Boolean(baseUrl || String(value(`${p}.token`))),
      baseUrl,
      token: String(value(`${p}.token`)),
      model: String(value(`${p}.model`)),
      provider: String(value(`${p}.provider`)).trim().toLowerCase() || String(defProvider),
      timeoutMs: Number(value(`${p}.timeoutMs`)) || Number(CONFIG_DEFS.find((d) => d.key === `${p}.timeoutMs`)?.default ?? 120_000),
      pollMs: Number(value(`${p}.pollMs`)) || Number(CONFIG_DEFS.find((d) => d.key === `${p}.pollMs`)?.default ?? 2000),
      maxPolls: Number(value(`${p}.maxPolls`)) || Number(CONFIG_DEFS.find((d) => d.key === `${p}.maxPolls`)?.default ?? 60),
    };
  }

  const routes: Record<string, CapabilityRoute> = {};
  for (const def of CONFIG_DEFS) {
    if (!def.key.startsWith('gateway.route.')) continue;
    const cap = def.key.slice('gateway.route.'.length) as CapabilityId;
    const v = String(value(def.key)).toLowerCase();
    routes[cap] = (ROUTE_VALUES as readonly string[]).includes(v) ? (v as CapabilityRoute) : 'auto';
  }

  const raw: RawConfig = { modalities, assetBase, routes, sources };

  cache = { at: Date.now(), raw };
  return raw;
}

/**
 * 某模态的通道配置。
 *
 * 每次调用都重新组装门面对象 (而非缓存门面) —— 门面持有 routeOf/sourcesOf
 * 两个闭包, 缓存它们会在缓存失效后仍返回旧闭包引用。
 */
export function gatewayConfigOf(modality: Modality): ModalityConfig {
  const raw = resolveGatewayConfig();
  const m = raw.modalities[modality];
  return {
    enabled: m.enabled,
    baseUrl: m.baseUrl,
    token: m.token,
    model: m.model,
    provider: m.provider,
    timeoutMs: m.timeoutMs,
    pollMs: m.pollMs,
    maxPolls: m.maxPolls,
    assetBase: raw.assetBase,
    routeOf: (capability: string) => raw.routes[capability] ?? 'auto',
    sourcesOf: () => ({ ...raw.sources }),
  };
}

/**
 * image 模态的通道配置 —— 既有调用点 (图像 provider / 路由器) 的门面。
 *
 * 纯别名转发, 不引入第二份状态: 路由表与素材基址本就是全模态共享的
 * (能力 id 全局唯一, 参考图基址与模态无关)。
 */
export function gatewayConfig(): GatewayConfig {
  return gatewayConfigOf('image');
}

function coerce(type: string, raw: string, fallback: string | number | boolean): string | number | boolean {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(fallback);
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  return raw;
}