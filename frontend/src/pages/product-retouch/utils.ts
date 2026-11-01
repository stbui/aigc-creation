import { MODE_TO_TEMPLATE } from './constants';

/**
 * 产品精修页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的提交参数拼装。
 */

/** 提交给 `useToolTask` 的高级设置 (与 `ToolShell` 回传一致) */
export interface RetouchSettings {
  ratio: string;
  resolution: string;
}

/**
 * 把「模式 + 补充要求 + 高级设置」拼成任务参数。
 *
 * - `note` 与 `additionalRequirement` 是同一段用户输入的两个字段名,
 *   后端两条读法都认, 保持同时下发;
 * - `imageRatio` 只在用户显式改过比例时出现, 原比例不带该字段,
 *   避免服务端把「原比例」当成一次重设;
 * - 模板码由 `mode` 唯一确定, 页面不再自行拼字符串。
 */
export function retouchPayload(
  mode: string,
  note: string,
  settings: RetouchSettings,
): Record<string, unknown> {
  const trimmedNote = note.trim();
  return {
    mode,
    note: trimmedNote,
    templateCode: MODE_TO_TEMPLATE[mode],
    additionalRequirement: trimmedNote,
    ...(settings.ratio !== 'original' ? { imageRatio: settings.ratio } : {}),
    ratio: settings.ratio,
    size: settings.resolution,
  };
}
