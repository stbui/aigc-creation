import type { AdminChannelView } from '../../../types/model';
import type { SegmentedOption, SelectOption } from './components';
import type { ChannelHeader } from './ChannelHeadersEditor';

/**
 * 渠道新建 / 编辑表单的本地草稿。
 *
 * 凭证只在内存里，保存后不回读；`apiKey` / `secretKey` 留空表示「不修改」。
 */
export interface ChannelDraft {
  name: string;
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  proxyUrl: string;
  useGlobalConcurrency: boolean;
  concurrencyLimit: string;
  enabled: boolean;
  sortOrder: string;
  headers: ChannelHeader[];
  reason: string;
}

export const EMPTY_DRAFT: ChannelDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  secretKey: '',
  proxyUrl: '',
  useGlobalConcurrency: true,
  concurrencyLimit: '8',
  enabled: true,
  sortOrder: '0',
  headers: [],
  reason: '',
};

export function toDraft(channel: AdminChannelView): ChannelDraft {
  return {
    name: channel.name,
    baseUrl: channel.baseUrl,
    apiKey: '',
    secretKey: '',
    proxyUrl: channel.proxyUrl,
    // 并发 0 表示跟随全局上限
    useGlobalConcurrency: channel.concurrencyLimit === 0,
    concurrencyLimit: String(channel.concurrencyLimit || 8),
    enabled: channel.enabled,
    sortOrder: String(channel.sortOrder ?? 0),
    headers: channel.headers ?? [],
    reason: '',
  };
}

/** 渠道级健康汇总：把该渠道下各线路的 24h 样本加总，左列一眼看出哪家在坏 */
export interface ChannelHealthSummary {
  samples: number;
  success: number;
}

/** 视图切换：`channels` = 按渠道配置，`models` = 跨渠道排查 */
export const CHANNEL_VIEW_OPTIONS: SegmentedOption[] = [
  { value: 'channels', label: '按渠道' },
  { value: 'models', label: '全部模型' },
];

export const CHANNEL_STATUS_OPTIONS: SelectOption[] = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];
