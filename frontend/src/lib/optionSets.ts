import { capabilityById } from './capabilities';
import type { ParamOption } from '../types/api';

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

/** 画质档位。取自商品主图能力（param key 为 `size`）。 */
export function qualityOptions(): ParamOption[] {
  return optionsOf('main_image', 'size');
}

export type ResolutionOption = ParamOption & {
  /** 卡片副文。参考站是 `{multiplier}倍消耗`（bundle 字符串表 index 0x4ab4） */
  sub: string;
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
 * 可用性由该能力此刻的实际路由决定（`runtime.remoteAvailable`）：
 *   - 4K 档：有模型通道 → 可选；没有模型通道 → 禁用并说明
 *     不隐藏 —— 隐藏会让用户以为没这个档位
 *   - 其余档位：有模型通道即可选
 * 不传 capabilityId 时按「拿不到证据就不放开」处理：4K 禁用。
 *
 * 副文（2026-10-21 改）：参考站卡片副文是 `{multiplier}倍消耗`
 * （`.image-output-resolution-option span`，文案取自 bundle 字符串表 0x4ab4「倍消耗」）。
 * `multiplier` 由参考站的 `billing-config` 下发，本站没有分辨率倍率 ——
 * `generate.service` 的扣费只取能力价，与 size 无关，故三档一律 1 倍，
 * 这正是本站的真实计费，不跟随参考站的档位倍率臆造 2 倍/4 倍。
 */
export function resolutionOptions(capabilityId?: string): ResolutionOption[] {
  const remote = capabilityId
    ? capabilityById(capabilityId)?.runtime?.remoteAvailable === true
    : false;
  return qualityOptions().map((o) => {
    const base: ResolutionOption = { ...o, sub: '1倍消耗' };
    if (o.value !== '4k' || remote) return base;
    return { ...base, disabled: true, disabledReason: '4K 需要支持该规格的模型通道，当前通道不可用' };
  });
}
