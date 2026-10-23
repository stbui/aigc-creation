import type {
  AdminModelChannelRecord,
  AdminModelChannelSnapshot,
  AdminChannelTestResult,
  Modality,
  VendorPreset,
} from '../../../types/api';

/**
 * 模型配置页的展示文案与派生逻辑。
 *
 * 原则：界面给运营看的是「线路 / 接入地址 / 访问令牌 / 尝试顺序」，
 * 不直接把 baseUrl / pollMs / failCount 这些字段名摊在页面上；
 * 需要排查时再在 tooltip 或 <code> 里给原始值。
 */

export const MODALITY_ORDER: Modality[] = ['image', 'text', 'video'];

export const MODALITY_LABEL: Record<Modality, string> = {
  image: '文生图',
  text: '文生文',
  video: '文生视频',
};

/** 模态未配置时，失败后果不同：图像会回落本地，文本/视频直接失败 */
export const MODALITY_EMPTY_HINT: Record<Modality, string> = {
  image: '未接入真实模型时：有本地算法的能力回落本地出图，本地没有实现的能力（创意生图 / 局部重绘 / 图片翻译 / 自由创作）直接失败并退款。',
  text: '文生文没有本地兜底，未接入时调用会直接失败。',
  video: '文生视频没有本地兜底，未接入时调用会直接失败。',
};

export const SOURCE_META: Record<string, { label: string; tone: string; hint: string }> = {
  env: {
    label: '环境变量',
    tone: 'is-danger',
    hint: '该项被部署环境变量覆盖，后台修改不会生效；下方可对照后台曾保存的值。',
  },
  db: { label: '后台已改', tone: 'is-success', hint: '当前使用后台写入的值，保存后立即生效。' },
  default: { label: '默认值', tone: 'is-muted', hint: '当前使用代码内置默认值。' },
};

export const ROUTE_OPTIONS = [
  { value: 'auto', label: '自动（有可用线路就走远程）' },
  { value: 'local', label: '仅本地算法' },
  { value: 'remote', label: '仅远程模型' },
];

/** 表格内用短标签，避免 15 行重复同一句长文案 */
export const ROUTE_OPTIONS_SHORT = [
  { value: 'auto', label: '自动', title: '有可用线路就走远程，否则按该模态兜底规则处理' },
  { value: 'local', label: '仅本地', title: '强制使用本地算法，不调用远程模型' },
  { value: 'remote', label: '仅远程', title: '强制走远程模型；无可用线路时按该模态兜底规则处理' },
];

export const ROUTE_LABEL: Record<string, string> = {
  auto: '自动',
  local: '仅本地',
  remote: '仅远程',
};

export const EFFECTIVE_LABEL: Record<string, string> = {
  gateway: '真实模型',
  local: '本地算法',
  none: '未接入（会失败）',
};

export const EFFECTIVE_TONE: Record<string, string> = {
  gateway: 'is-success',
  local: 'is-warn',
  none: 'is-danger',
};

/** 既有 tone 命名 → antd Tag 的 color */
export function tagColor(tone: string): string {
  if (tone === 'is-success') return 'success';
  if (tone === 'is-warn') return 'warning';
  if (tone === 'is-danger') return 'error';
  if (tone === 'is-brand') return 'purple';
  return 'default';
}

/**
 * 协议的人话说明。
 *
 * 后端协议描述里带 `{base}/v1/...` 端点，适合排障时看，不适合摆在表单正文里。
 * 页面上给一句人话，端点放 tooltip。
 */
export const PROTOCOL_HINT: Record<string, string> = {
  openai: 'OpenAI 兼容同步协议，多数厂商通用。',
  volcengine: '火山方舟专用协议，尺寸按 1K / 2K 档位。',
  minimax: 'MiniMax 图像协议，尺寸用画面比例表达。',
  'openai-chat': 'OpenAI 兼容对话补全协议，DeepSeek / Moonshot / 硅基流动通用。',
  'minimax-video': 'MiniMax 四段式异步视频协议：提交、轮询、取文件、下载。',
};

/** 厂商预设名去掉模态后缀：在文生图面板里不必再重复「（文生图）」 */
export function vendorDisplayLabel(label: string): string {
  return label.replace(/（文生(图|文|视频)）$/, '').trim();
}

/** 「文生图 · 网关基址」在文生图面板里只显示「网关基址」 */
export function withoutModalityPrefix(label: string, modality: Modality): string {
  const prefix = `${MODALITY_LABEL[modality]} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

export const DISPATCH_SOURCE_META: Record<
  AdminModelChannelSnapshot['source'],
  { label: string; tone: string; hint: string }
> = {
  channels: {
    label: '按线路列表调度',
    tone: 'is-success',
    hint: '该模态已按下方线路顺序尝试；旧版单通道参数不再参与调度。',
  },
  legacy: {
    label: '沿用旧版配置',
    tone: 'is-warn',
    hint: '当前没有落库线路，沿用「全局设置」里的旧版单通道参数。新增线路后即切换为线路调度。',
  },
  none: {
    label: '未接入',
    tone: 'is-danger',
    hint: '没有任何可用线路，也没有启用旧版配置。',
  },
};

/** 接入地址只显示 host，避免长 URL 撑爆表格；完整值放 tooltip */
export function hostOf(baseUrl: string): string {
  if (!baseUrl) return '';
  try {
    const u = new URL(baseUrl);
    return u.host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

/** 毫秒 → 人话 */
export function fmtLatency(ms: number): string {
  if (!ms) return '未发起请求';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN');
}

export interface HealthMeta {
  label: string;
  tone: string;
  hint?: string;
}

/** 健康度只来自真实调用（测试结果单独展示，避免把「能连通」当成「健康」） */
export function healthMeta(ch: AdminModelChannelRecord): HealthMeta {
  if (ch.synthetic) return { label: '旧版配置', tone: 'is-warn', hint: '尚未转为可管理线路' };
  if (!ch.enabled) return { label: '已停用', tone: 'is-muted', hint: '不参与调度，但仍可测试' };
  if (ch.cooldownUntil && Date.parse(ch.cooldownUntil) > Date.now()) {
    return {
      label: `暂停尝试至 ${new Date(ch.cooldownUntil).toLocaleTimeString('zh-CN')}`,
      tone: 'is-danger',
      hint: `连续失败 ${ch.failCount} 次，调度会跳过该线路直到冷却结束`,
    };
  }
  if (ch.failCount > 0) {
    return { label: `连续失败 ${ch.failCount} 次`, tone: 'is-warn', hint: '再次失败将进入冷却' };
  }
  if (ch.lastSuccessAt) return { label: '正常', tone: 'is-success', hint: `最近成功 ${fmtTime(ch.lastSuccessAt)}` };
  return { label: '尚无调用记录', tone: 'is-muted', hint: '还没有真实生成走过这条线路' };
}

/** 用 baseUrl + protocol 反查厂商预设；模型名可能被手工改过，不作为匹配依据 */
export function matchVendor(
  ch: Pick<AdminModelChannelRecord, 'baseUrl' | 'protocol'>,
  vendors: VendorPreset[],
): VendorPreset | undefined {
  const base = ch.baseUrl.replace(/\/+$/, '');
  return vendors.find(
    (v) => v.baseUrl.replace(/\/+$/, '') === base && v.protocol === ch.protocol,
  );
}

/* ── 测试结果缓存（按线路 + updatedAt 失效，绝不含令牌/请求体） ────────── */

const TEST_CACHE_PREFIX = 'admin.modelCfg.channelTest.';

interface CachedTest {
  testedAt: string;
  updatedAt: string | null;
  result: Pick<AdminChannelTestResult, 'ok' | 'latencyMs' | 'message' | 'detail' | 'target'>;
}

export function readCachedTest(id: string, updatedAt: string | null): CachedTest | null {
  try {
    const raw = sessionStorage.getItem(TEST_CACHE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTest;
    // 配置改过（updatedAt 变化）则旧结论不再可信
    if ((parsed.updatedAt ?? null) !== (updatedAt ?? null)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedTest(id: string, updatedAt: string | null, result: CachedTest['result']): void {
  try {
    const payload: CachedTest = {
      testedAt: new Date().toISOString(),
      updatedAt,
      result,
    };
    sessionStorage.setItem(TEST_CACHE_PREFIX + id, JSON.stringify(payload));
  } catch {
    // 隐私模式/配额满：忽略，不影响功能
  }
}

export function clearCachedTest(id: string): void {
  try {
    sessionStorage.removeItem(TEST_CACHE_PREFIX + id);
  } catch {
    // ignore
  }
}
