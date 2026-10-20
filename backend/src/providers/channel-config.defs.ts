/**
 * 模型通道配置项定义 —— 后台「模型配置」页的单一事实源。
 *
 * 为什么把原先散在 gateway.config.ts 里的 env 常量搬到这里声明:
 * 后台要能编辑这些项, 而可编辑的前提是「每一项有类型/默认值/取值范围/说明」——
 * 否则运营能写进代码根本不认识的键, 或写入越界值后读取时静默出错
 * (与 admin/settings.dto.ts 的 SETTING_DEFS 完全同构, 故沿用其写法)。
 *
 * 优先级链 (三者都生效, 从高到低):
 *   1. 环境变量 <KEY>_ENV / ASSET_PUBLIC_BASE —— 部署期固化, 最高优先
 *   2. 本表 ModelChannelConfig —— 后台运行时写入, 改完即时生效无需重启
 *   3. 本文件的 default —— 代码默认值
 *
 * ⚠️ 为什么 env 反而优先级更高: 容器化部署里 env 是运维的最后一道闸门,
 * 若后台能覆盖 env, 一个误点就能让线上生图静默切换通道。
 * 前端据此如实展示每项的实际来源 (env / db / default), 不让运营误判改没改成。
 *
 * ── 模态维度 (2026-10-20) ────────────────────────────────────────────
 * 配置项按模态分前缀: gateway.image.* / gateway.text.* / gateway.video.*。
 * 每个模态有**独立的基址/令牌/模型/协议**, 因为现实中三家厂商通常各不相同
 * (DeepSeek 只有文, 优云智算只有图, 火山两边都有但端点不同)。
 * 强行共享一套 baseUrl/token 会导致「配好了图通道却把文生文请求发到生图端点」。
 *
 * 存量兼容: 改造前的 `gateway.*` 键(已写入生产的那些) 不删不改名, 通过
 * ConfigDef.legacyKey 声明为 `gateway.image.*` 的别名 —— 读取时新键优先,
 * 新键无任何来源时才回落旧键。详见 gateway.config.ts 的 resolveValue。
 */

import { MODALITIES, type Modality } from './modality';
import { CAPABILITIES } from '../capabilities/capability.registry';

export type ConfigType = 'string' | 'number' | 'boolean' | 'secret';

export type ConfigGroup = 'base' | 'timeout' | 'asset' | 'route';

export interface ConfigDef {
  key: string;
  label: string;
  description: string;
  type: ConfigType;
  default: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  group: ConfigGroup;
  /** 环境变量名; 有值则该 env 存在时优先于 DB */
  envName?: string;
  /**
   * 凭据类 (secret): 读取时**永不回显明文**, 只返回 hasValue + 脱敏尾巴;
   * 写入留空表示保持原值, 需显式 clear 才会清除。
   */
  secret?: boolean;
  /**
   * 存量键别名 (2026-10-20 模态拆分用)。
   *
   * 改造前所有通道配置共用 `gateway.*` 单前缀, 现已按模态改为 `gateway.<modality>.*`。
   * 本字段记录该项的旧键名, 读取时若新键在 env/DB/default 三处都没有取值,
   * 则回落读旧键 —— 已存生产的配置不因这次改造失效。
   *
   * 只有 image 模态有别名: 旧结构本来就是单一图像通道。
   */
  legacyKey?: string;
  /**
   * 该配置项所属模态; undefined 表示跨模态共用(如 asset.publicBase)
   */
  modality?: Modality;
  /**
   * 存量键, 仅作为回落读取源, **不在界面上出现** (2026-10-20)。
   *
   * ⚠️ 这些键必须继续留在 CONFIG_DEFS 里, 不能只写在 ConfigDef.legacyKey 字段上:
   * 回落逻辑用 findConfigDef(legacyKey) 反查类型与 env 名, 反查不到就静默跳过回落,
   * 表现为「改造完存量配置全丢了」—— 症状是配置还在库里却不再生效, 极难定位。
   */
  hidden?: boolean;
}

/**
 * 能力 id 清单 —— **由能力注册表派生** (2026-10-20 起)。
 *
 * ## 为什么不手写这份数组
 *
 * 改造前这里是 15 个 id 的字面量数组, 与 `capability.registry.ts` 的
 * CAPABILITIES 平行维护。两处靠人手同步, 而不同步的症状**不会报错**:
 *   - defs 多一项 → 后台多出一条永远用不上的路由配置项
 *   - defs 少一项 → 新能力没有 `gateway.route.<id>` 配置项, 后台页面少一行,
 *                   运营**无法为这项能力单独设置路由** (只能吃全局默认 auto)
 * 后者尤其隐蔽: 功能看着正常, 只是少了个可配项, 不专门去数行数发现不了。
 *
 * 现在改为从注册表派生, 新增能力只需改 definitions 一处, 路由配置自动出现。
 *
 * ⚠️ 用 as const 而非硬编码字面量类型: 派生出来的类型是 string 而非 15 个字面量
 * 的联合。CapabilityId 因此退化为 string —— 这是**有意的取舍**: 保留字面量联合
 * 就得再手写一遍 id 列表, 又回到两份真相。配置键的正确性改由
 * assertCapabilityIntegrity 与运行时的 findConfigDef 校验保证。
 */
export const CAPABILITY_IDS = CAPABILITIES.map((c) => c.id);

export type CapabilityId = string;

/** 模态 → 配置项 key 前缀 */
const MODALITY_PREFIX: Record<Modality, string> = {
  text: 'gateway.text',
  image: 'gateway.image',
  video: 'gateway.video',
};

/** 模态 → 旧单前缀键名 (存量 image 通道配置) */
const MODALITY_LEGACY_KEY: Partial<Record<Modality, string>> = {
  image: 'gateway',
};

/** 该模态在页面上的中文名, 用于自动生成的配置项 label */
const MODALITY_LABEL: Record<Modality, string> = {
  text: '文生文',
  image: '文生图',
  video: '文生视频',
};

/** 每个模态的基址/令牌/模型/协议/厂商/启用 —— 一组六项 */
function modalityBaseDefs(modality: Modality): ConfigDef[] {
  const p = MODALITY_PREFIX[modality];
  const legacy = MODALITY_LEGACY_KEY[modality];
  // 存量键只在 image 上存在; 拼接时去掉 legacy 前缀的尾点 (gateway.baseUrl)
  const oldKey = (leaf: string) => (legacy ? `${legacy}.${leaf}` : undefined);

  return [
    {
      key: `${p}.baseUrl`,
      label: `${MODALITY_LABEL[modality]} · 网关基址`,
      description:
        modality === 'text'
          ? '大模型服务的根域地址, 如 https://api.deepseek.com。本项目只存根域, /v1/chat/completions 由服务端补'
          : '模型网关的服务地址, 如 https://api.modelverse.cn。留空表示未接入真实模型, 该模态全部走本地算法',
      type: 'string',
      default: '',
      maxLength: 200,
      group: 'base',
      envName: `GATEWAY_${modality.toUpperCase()}_BASE_URL`,
      legacyKey: oldKey('baseUrl'),
      modality,
    },
    {
      key: `${p}.token`,
      label: `${MODALITY_LABEL[modality]} · 令牌`,
      description: '访问该模态网关的 Bearer token。凭据只写不回显, 留空提交表示保持原值',
      type: 'secret',
      default: '',
      maxLength: 500,
      group: 'base',
      envName: `GATEWAY_${modality.toUpperCase()}_TOKEN`,
      secret: true,
      legacyKey: oldKey('token'),
      modality,
    },
    {
      key: `${p}.model`,
      label: `${MODALITY_LABEL[modality]} · 默认模型`,
      description: '指定模型名。留空则使用该预设推荐的默认模型',
      type: 'string',
      default: '',
      maxLength: 120,
      group: 'base',
      envName: `GATEWAY_${modality.toUpperCase()}_MODEL`,
      legacyKey: oldKey('model'),
      modality,
    },
    {
      key: `${p}.provider`,
      label: `${MODALITY_LABEL[modality]} · 通道协议`,
      description:
        modality === 'text'
          ? 'openai-chat=OpenAI 兼容对话补全 (POST {base}/v1/chat/completions), DeepSeek/Moonshot/硅基流动/OpenAI 官方'
          : modality === 'video'
            ? '文生视频协议尚未取证, 当前无可选协议。填入任何值都会在生成时报错并回落'
            : 'openai=OpenAI兼容同步(POST {base}/v1/images/generations); volcengine=火山方舟(size 用 1K/2K 档位); minimax=MiniMax(用 aspect_ratio); aigc=自研异步任务契约。建议在页面顶部用「厂商预设」选择, 自动填好本项',
      type: 'string',
      default: modality === 'text' ? 'openai-chat' : 'openai',
      group: 'base',
      envName: `GATEWAY_${modality.toUpperCase()}_PROVIDER`,
      legacyKey: oldKey('provider'),
      modality,
    },
    {
      key: `${p}.vendor`,
      label: `${MODALITY_LABEL[modality]} · 厂商预设`,
      description:
        '仅作标识: 记录当前用的是哪套内置预设, 便于回看配置来源。留空表示手动自定义。改厂商请在页面顶部下拉选择, 它会自动填写基址/协议/模型三项',
      type: 'string',
      default: '',
      maxLength: 40,
      group: 'base',
      envName: `GATEWAY_${modality.toUpperCase()}_VENDOR`,
      legacyKey: oldKey('vendor'),
      modality,
    },
    {
      key: `${p}.enabled`,
      label: `${MODALITY_LABEL[modality]} · 强制启用远程通道`,
      description:
        '开启后即使基址与令牌都为空也尝试走远程 (用于临时排障)。网关不可达时仍会回落本地算法',
      type: 'boolean',
      default: false,
      group: 'base',
      envName: `GATEWAY_${modality.toUpperCase()}_ENABLED`,
      legacyKey: oldKey('enabled'),
      modality,
    },
  ];
}

/** 每个模态的超时/轮询 —— 视频耗时远长于图文, 故必须按模态分开配 */
function modalityTimeoutDefs(modality: Modality): ConfigDef[] {
  const p = MODALITY_PREFIX[modality];
  const legacy = MODALITY_LEGACY_KEY[modality];
  const oldKey = (leaf: string) => (legacy ? `${legacy}.${leaf}` : undefined);
  // 视频默认给更长的超时: 同步出视频常见分钟级, 沿用图/文的 120s 会必然超时
  const timeoutDefault = modality === 'video' ? 600_000 : 120_000;
  const timeoutMax = modality === 'video' ? 1_800_000 : 600_000;

  return [
    {
      key: `${p}.timeoutMs`,
      label: `${MODALITY_LABEL[modality]} · 单次调用总超时`,
      description: '含网关轮询全过程。超时后回落本地算法',
      type: 'number',
      default: timeoutDefault,
      min: 5000,
      max: timeoutMax,
      group: 'timeout',
      envName: `GATEWAY_${modality.toUpperCase()}_TIMEOUT_MS`,
      legacyKey: oldKey('timeoutMs'),
      modality,
    },
    {
      key: `${p}.pollMs`,
      label: `${MODALITY_LABEL[modality]} · 轮询间隔`,
      description: '查询网关任务状态的间隔',
      type: 'number',
      default: 2000,
      min: 200,
      max: 30000,
      group: 'timeout',
      envName: `GATEWAY_${modality.toUpperCase()}_POLL_MS`,
      legacyKey: oldKey('pollMs'),
      modality,
    },
    {
      key: `${p}.maxPolls`,
      label: `${MODALITY_LABEL[modality]} · 最大轮询次数`,
      description: '超出视为轮询超时并回落本地算法',
      type: 'number',
      default: modality === 'video' ? 300 : 60,
      min: 1,
      max: 1000,
      group: 'timeout',
      envName: `GATEWAY_${modality.toUpperCase()}_MAX_POLLS`,
      legacyKey: oldKey('maxPolls'),
      modality,
    },
  ];
}

/** 逐能力路由 —— 键名保持 gateway.route.<capability> 不变(能力 id 全局唯一) */
function routeDefs(): ConfigDef[] {
  return CAPABILITIES.map<ConfigDef>((cap) => ({
    key: `gateway.route.${cap.id}`,
    label: `路由 · ${cap.id}`,
    description: 'auto=网关可用则远程 / local=强制本地算法 / remote=强制远程',
    type: 'string' as ConfigType,
    default: 'auto',
    group: 'route' as ConfigGroup,
    envName: `GATEWAY_ROUTE_${cap.id.toUpperCase()}`,
    /*
     * 模态取自能力自身声明, 不再写死 'image'。
     *
     * 改造前这里是硬编码的 modality: 'image' + 一句注释说明"未来新增文本/视频
     * 能力时要记得改" —— 那正是本轮要消灭的"改四处"。现在能力一注册,
     * 路由配置项连同它的模态自动到位。
     */
    modality: cap.modality,
  }));
}

/**
 * 存量单前缀键 (2026-10-20 模态拆分前的结构)。
 *
 * 为什么必须保留而不是只记 key 字符串: 回退链靠 findConfigDef(legacyKey)
 * 反查该键的 type 与 envName。反查不到就静默跳过回落, 表现为
 * 「DB 里的配置还在, 但改造后不生效了」—— 而且 env 也会一起失效
 * (生产部署普遍在设 GATEWAY_BASE_URL), 属于上线即事故。
 *
 * hidden=true 让它们不出现在界面上: 界面只展示新键, 避免运营同时看到两套
 * 含义重叠的输入框而不知道该改哪个。
 *
 * 注意 env 名**保持原样**(GATEWAY_BASE_URL 而非 GATEWAY_IMAGE_BASE_URL):
 * 已部署环境的 .env 里就是旧名, 改了就等于要求同步改所有部署。
 */
const LEGACY_DEFS: ConfigDef[] = [
  {
    key: 'gateway.baseUrl',
    label: '网关基址（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源。新配置请写 gateway.image.baseUrl',
    type: 'string',
    default: '',
    maxLength: 200,
    group: 'base',
    envName: 'GATEWAY_BASE_URL',
    hidden: true,
  },
  {
    key: 'gateway.token',
    label: '网关令牌（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'secret',
    default: '',
    maxLength: 500,
    group: 'base',
    envName: 'GATEWAY_TOKEN',
    secret: true,
    hidden: true,
  },
  {
    key: 'gateway.model',
    label: '默认模型（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'string',
    default: '',
    maxLength: 120,
    group: 'base',
    envName: 'GATEWAY_MODEL',
    hidden: true,
  },
  {
    key: 'gateway.provider',
    label: '通道协议（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'string',
    default: 'openai',
    group: 'base',
    envName: 'GATEWAY_PROVIDER',
    hidden: true,
  },
  {
    key: 'gateway.vendor',
    label: '厂商预设（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'string',
    default: '',
    maxLength: 40,
    group: 'base',
    envName: 'GATEWAY_VENDOR',
    hidden: true,
  },
  {
    key: 'gateway.enabled',
    label: '强制启用远程通道（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'boolean',
    default: false,
    group: 'base',
    envName: 'GATEWAY_ENABLED',
    hidden: true,
  },
  {
    key: 'gateway.timeoutMs',
    label: '单次调用总超时（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'number',
    default: 120000,
    min: 5000,
    max: 600000,
    group: 'timeout',
    envName: 'GATEWAY_TIMEOUT_MS',
    hidden: true,
  },
  {
    key: 'gateway.pollMs',
    label: '轮询间隔（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'number',
    default: 2000,
    min: 200,
    max: 30000,
    group: 'timeout',
    envName: 'GATEWAY_POLL_MS',
    hidden: true,
  },
  {
    key: 'gateway.maxPolls',
    label: '最大轮询次数（存量）',
    description: '2026-10-20 模态拆分前的单前缀键, 仅作回落读取源',
    type: 'number',
    default: 60,
    min: 1,
    max: 500,
    group: 'timeout',
    envName: 'GATEWAY_MAX_POLLS',
    hidden: true,
  },
];

export const CONFIG_DEFS: ConfigDef[] = [
  // ── 存量键 (hidden: 仅回落读取源, 不上界面) ───────────────────────
  ...LEGACY_DEFS,

  // ── 逐模态通道基址与超时 ────────────────────────────────────────────
  ...MODALITIES.flatMap((m) => modalityBaseDefs(m.value)),
  ...MODALITIES.flatMap((m) => modalityTimeoutDefs(m.value)),

  // ── 素材可达性 (跨模态共用) ─────────────────────────────────────────
  {
    key: 'asset.publicBase',
    label: '素材对外基址',
    description: '参考图回传给网关时的站内基址, 网关需能拉取到。留空则用 http://localhost:<后端端口>',
    type: 'string',
    default: '',
    maxLength: 200,
    group: 'asset',
    envName: 'ASSET_PUBLIC_BASE',
  },

  // ── 逐能力路由 ────────────────────────────────────────────────────
  ...routeDefs(),
];

export const CONFIG_GROUPS: Array<{ key: ConfigGroup; label: string; desc: string }> = [
  { key: 'base', label: '通道基址', desc: '各模态接入真实模型网关的地址与凭据' },
  { key: 'timeout', label: '超时与轮询', desc: '远程通道的等待策略, 超时自动回落本地' },
  { key: 'asset', label: '素材可达性', desc: '网关回拉参考图所需的站内可达地址' },
  { key: 'route', label: '逐能力路由', desc: '按能力单独决定走真实模型还是本地算法' },
];

export function findConfigDef(key: string): ConfigDef | undefined {
  return CONFIG_DEFS.find((d) => d.key === key);
}

/** 该模态的全部配置项 (前端按模态分栏渲染) */
export function defsForModality(modality: Modality): ConfigDef[] {
  return CONFIG_DEFS.filter((d) => d.modality === modality);
}

/**
 * 模态 → 前缀, 供 gateway.config 与后台服务拼键名。
 *
 * 单独导出而非让调用方各自拼字符串 —— 前缀写错一处就是"配了不生效"的静默失败,
 * 而这种失败在界面上完全看不出来 (值回落到 default, 看起来像"没配")。
 */
export function modalityPrefix(modality: Modality): string {
  return MODALITY_PREFIX[modality];
}

/** 路由取值白名单 */
export const ROUTE_VALUES = ['auto', 'local', 'remote'] as const;
export type RouteValue = (typeof ROUTE_VALUES)[number];