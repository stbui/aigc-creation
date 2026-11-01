/**
 * 图片翻译页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `image-translate/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的语言清单与任务参数拼装集中可见。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 目标语言清单 (来自能力参数目录, 随后台配置变化) */
export { languageOptions } from '../../lib/optionSets';

/** 提交给 `useToolTask` 的高级设置 (与 `ToolShell` 回传一致) */
export interface TranslateSettings {
  ratio: string;
  resolution: string;
}

/**
 * 把「目标语言 + 是否保护主体 + 画质」拼成任务参数。
 *
 * - `targetLang` 与 `targetLanguage` 是同一选择的两个字段名, 后端两条读法都认,
 *   保持同时下发;
 * - 本页没有比例档位, 只下发画质 (`size`), 服务端保持原图比例。
 */
export function translatePayload(
  targetLang: string,
  protectSubject: boolean,
  settings: TranslateSettings,
): Record<string, unknown> {
  return {
    targetLang,
    targetLanguage: targetLang,
    protectSubject,
    size: settings.resolution,
  };
}

/** 目标语言 → 中文名; 未配置的语言返回 `undefined`, 结果标签保持不显示。 */
export function languageLabelOf(
  options: readonly { value: string | number; label: string }[],
  value: string,
): string | undefined {
  return options.find((option) => option.value === value)?.label;
}
