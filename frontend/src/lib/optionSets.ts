import type { ParamOption, PlatformDetailSpec } from '../types/api';
import { capabilityById } from './capabilities';

/**
 * 参数选项集 —— 从后端能力清单读回，消除前端重复定义。
 *
 * 2026-10-19 抽取。此前 PLATFORMS / LANGUAGES / RATIOS / RESOLUTION 四张表在
 * 6 个文件里各写一份（合计 6+6+6+6 处），而后端 capability.registry 早已是唯一事实源
 * 并通过 GET /api/v1/capabilities 的 params 下发 —— 重复定义必然漂移。
 *
 * 取值方式：registry 里这些表以 param 的形式挂在能力上（如 main_image.params 里的
 * platform / language / ratio / resolution），所以按「能力 id + param key」读回即可，
 * 不需要后端额外导出常量。
 *
 * 读不到时返回空数组 —— 调用方需自行处理（表单无选项即无法提交，比展示错值安全）。
 */

/** 按 param key 从指定能力读回选项集 */
function optionsOf(capabilityId: string, paramKey: string): ParamOption[] {
  const def = capabilityById(capabilityId);
  const param = def?.params?.find((p) => p.key === paramKey);
  return param?.options ?? [];
}

/** 平台下拉（淘宝/京东/抖音/… 共 9 项）。取自商品主图能力。 */
export function platformOptions(): ParamOption[] {
  return optionsOf('main_image', 'platform');
}

/** 平台主图规格（比例 / 画质 / 最短边 / 提示词说明） */
export interface PlatformSpec {
  ratio: string;
  size: string;
  minPx?: number;
  spec?: string;
}

/**
 * 读取平台主图规格。
 *
 * 数据来自后端 `PLATFORMS[].meta`：切换平台时用它带出默认比例与画质，
 * 用户手动改过就不再覆盖。读不到时返回 `null`，调用方保持当前选择。
 */
export function platformSpec(value: string | undefined): PlatformSpec | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const meta = platformOptions().find((o) => String(o.value) === raw)?.meta;
  if (!meta?.ratio || !meta?.size) return null;
  return { ratio: meta.ratio, size: meta.size, minPx: meta.minPx, spec: meta.spec };
}

/**
 * 读取平台详情长图规格（详情页用）。
 *
 * 平台详情规格只提供成品宽度 / 画质建议；画面比例由详情能力的 ratio
 * 参数单独选择。数据来自后端 `PLATFORMS[].meta.detail`。
 */
export function platformDetailSpec(value: string | undefined): PlatformDetailSpec | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const detail = platformOptions().find((o) => String(o.value) === raw)?.meta?.detail;
  return detail?.size ? detail : null;
}

/** 输出语言下拉（10 项）。取自商品主图能力。 */
export function languageOptions(): ParamOption[] {
  return optionsOf('main_image', 'language');
}

/**
 * 画面比例。读取当前能力的 ratio 选项；修图系能力包含首项「原比例」，
 * 商品主图等生图能力则只有 8 项。不能固定读 main_image —— 那会让
 * 默认值为 original 的页面无法在弹层里重新选回原比例。
 */
export function ratioOptions(capabilityId?: string): ParamOption[] {
  const own = capabilityId ? optionsOf(capabilityId, 'ratio') : [];
  return own.length ? own : optionsOf('main_image', 'ratio');
}

/**
 * 画质档位。优先读当前能力自己的 `size` 枚举；未声明时回落到商品主图。
 * 固定读 main_image 会在两类能力的档位分叉后把不支持的档位放进页面，
 * 提交时被后端枚举校验拒绝。
 */
export function qualityOptions(capabilityId?: string): ParamOption[] {
  const own = capabilityId ? optionsOf(capabilityId, 'size') : [];
  return own.length ? own : optionsOf('main_image', 'size');
}

export type ResolutionOption = ParamOption & {
  /** 卡片副文。参考站是 `{multiplier}倍消耗`（bundle 字符串表 index 0x4ab4） */
  sub: string;
  /** 画质倍率。多图融合与参考站 billing-config 对齐，其余能力按 1 倍。 */
  multiplier: number;
  /** 参考站卡片标题的短文案（多图融合为 1K/2K/4K，不带像素说明）。 */
  shortLabel?: string;
  disabled?: boolean;
  /** 不可选原因。参考站卡片不显示原因，只作 hover 提示 */
  disabledReason?: string;
};

/**
 * 画质档位 + 档位可用性。
 *
 * 档位清单**只来自后端**（能力的 `size` 参数枚举，2026-10-22 起后端已声明
 * 1K/2K/4K 三档）。此前是后端只给两档、前端按运行时补第三档，那是错的：
 * 后端不认的档位靠前端兜，直接调接口传 `size=4k` 会被 sanitizeParams
 * 静默回落成默认值，而界面看起来是可选的。
 *
 * 可用性优先按所选模型的 `imageResolution` 合同（`supportedValues`）判定，
 * 未提供时才回落到该能力此刻的实际路由（`runtime.remoteAvailable`）：
 *   - 模型合同声明了可取档位 → 不在清单里的档位禁用并说明；
 *   - 未声明 → 4K 有模型通道才可选，其余档位有通道即可选；
 *   - 都不提供 → 「拿不到证据就不放开」，4K 禁用。
 *     不隐藏 —— 隐藏会让用户以为没这个档位。
 *
 * 副文（2026-10-28 改）：多图融合按参考站 `billing-config` 使用
 * `1K=1倍 / 2K=2倍 / 4K=3倍`，后端扣费同口径；其它能力仍按基础价 1 倍。
 */
export function resolutionOptions(
  capabilityId?: string,
  supportedValues?: readonly unknown[] | null,
): ResolutionOption[] {
  const remote = capabilityId
    ? capabilityById(capabilityId)?.runtime?.remoteAvailable === true
    : false;
  const fusion = capabilityId === 'multi_fusion';
  /*
   * 模型能力合同声明了 `imageResolution` 时以它为准：只看「能力有没有任意
   * 健康线路」会把不支持的 4K 放出来，提交后要么被拒、要么被静默降档。
   * 未声明时才回落到原来的能力级可用性。
   */
  const supported =
    supportedValues && supportedValues.length > 0
      ? new Set(supportedValues.map((value) => String(value).trim().toLowerCase()))
      : null;
  const allowAll = supported?.has('*') ?? false;
  return qualityOptions(capabilityId).map((o) => {
    const multiplier = fusion
      ? ({ '1k': 1, '2k': 2, '4k': 3 }[String(o.value).toLowerCase()] ?? 1)
      : 1;
    const base: ResolutionOption = {
      ...o,
      ...(fusion ? { shortLabel: String(o.value).toUpperCase() } : {}),
      multiplier,
      sub: `${multiplier}倍消耗`,
    };
    const value = String(o.value).trim().toLowerCase();
    const allowed = supported ? allowAll || supported.has(value) : value !== '4k' || remote;
    if (allowed) return base;
    return {
      ...base,
      disabled: true,
      disabledReason: supported
        ? '当前模型不支持该画质'
        : '4K 需要支持该规格的模型通道，当前通道不可用',
    };
  });
}
