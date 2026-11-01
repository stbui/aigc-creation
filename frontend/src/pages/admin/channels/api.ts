/**
 * 渠道工作台的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定: `channels/` 下的文件不从 `src/lib/api` 直接取东西, 一律经由本文件 ——
 * 页面与组件用到的接口对象集中可见, 替换实现或加埋点只改一处。
 * 目录内新增接口引用时在这里补一行 re-export。
 *
 * 本目录组合出来的取数逻辑 (`fetchAllChannels` / `fetchChannelHealth`) 也在本文件:
 * 它们只服务这里的分页与健康汇总, 不是通用接口。
 */

import { adminChannelModelsApi, adminChannelsApi } from '../../../lib/api';
import type { AdminChannelView } from '../../../types/model';

// 本文件既要用这两个接口对象，也要把它们转给目录内其它文件
export { adminChannelModelsApi, adminChannelsApi };

/** 渠道数量在几十的量级，100 足够一次拿完；后续翻页只作兜底 */
const CHANNEL_PAGE_SIZE = 100;

/**
 * 一次取全量渠道（自动翻页并按 id 去重）。
 *
 * 左列是常驻导航，分页会把「刚建好的渠道」藏到第二页，而运营建完渠道的
 * 第一件事就是去点它。全量拉取比维护一套分页状态更划算。
 */
export async function fetchAllChannels(): Promise<AdminChannelView[]> {
  const first = await adminChannelsApi.list({ page: 1, limit: CHANNEL_PAGE_SIZE });
  const all = [...first.channels];
  for (let page = 2; all.length < first.total; page += 1) {
    const next = await adminChannelsApi.list({ page, limit: CHANNEL_PAGE_SIZE });
    if (next.channels.length === 0) break;
    all.push(...next.channels);
  }
  return Array.from(new Map(all.map((row) => [row.id, row])).values());
}

/** 线路健康指标（一行 = 一条渠道模型，含进程内冷却快照） */
export function fetchChannelHealth() {
  return adminChannelModelsApi.health();
}
