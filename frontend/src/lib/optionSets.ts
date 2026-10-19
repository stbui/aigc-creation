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

/** 画面比例（8 项）。取自商品主图能力。 */
export function ratioOptions(): ParamOption[] {
  return optionsOf('main_image', 'ratio');
}

/** 画质档位。取自商品主图能力（param key 为 `size`）。 */
export function qualityOptions(): ParamOption[] {
  return optionsOf('main_image', 'size');
}

/**
 * 画质档位 + 本地能力覆盖。
 *
 * 参考站是 1K/2K/4K 三档，本地 Jimp 算法上限 2048px，故 4K 在界面上**如实禁用**
 * （不是隐藏 —— 隐藏会让用户以为项目没这个档位）。此项是本地诚实差异，
 * 不由后端下发：后端 registry 只声明可用的 1K/2K。
 */
export function resolutionOptions(): Array<ParamOption & { sub: string; disabled?: boolean }> {
  const base = qualityOptions();
  return [
    ...base.map((o) => ({ ...o, sub: o.value === '1k' ? '1024px' : '2048px' })),
    { value: '4k', label: '4K', sub: '本地算法暂不支持', disabled: true },
  ];
}