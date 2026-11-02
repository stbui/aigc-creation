/**
 * 插件的静态文案与派生展示。
 */

import type { PluginView } from '../../../types/model';

/** 贡献项 → 非零条目文本 */
export function contributionText(plugin: PluginView): string {
  const labels: Array<[keyof PluginView['contributions'], string]> = [
    ['providers', 'Provider'],
    ['smsProviders', '短信'],
    ['paymentProviders', '支付'],
    ['workflows', '工作流'],
    ['canvasNodes', '画布节点'],
    ['transforms', '变换'],
    ['commands', '命令'],
    ['assetSources', '素材源'],
    ['usageObservers', '用量观察'],
    ['aiCapabilities', 'AI 能力'],
    ['agents', '智能体'],
    ['importExport', '导入导出'],
  ];
  const parts = labels
    .filter(([key]) => Number(plugin.contributions?.[key] ?? 0) > 0)
    .map(([key, label]) => `${label} ${plugin.contributions[key]}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}
