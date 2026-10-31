/**
 * 阿里云百炼（DashScope / MaaS）的补充模型目录。
 *
 * 移植自 open-ai-canvas `internal/provider/bailian/discovery.go`。百炼的
 * `/models` 只返回基础目录，视频与部分图像模型不在其中；这份清单补上它们，
 * 让后台「上游拉取」能看到可配的模型。**这里只列模型与能力，不代表已定价**：
 * 导入后仍默认停用，管理员定价后再启用。
 *
 * 判定只看 Base URL 主机名：`*.dashscope.aliyuncs.com` / `dashscope-*.aliyuncs.com`
 * / `*.maas.aliyuncs.com`。
 */

import type { ChannelModelCatalogItem, ModelCatalogDiscovery } from '../model-catalog.types';

const BAILIAN_MODELS: ChannelModelCatalogItem[] = [
  {"id":"happyhorse-1.1-t2v","displayName":"HappyHorse 1.1 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"happyhorse-1.1-i2v","displayName":"HappyHorse 1.1 图生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"happyhorse-1.1-r2v","displayName":"HappyHorse 1.1 参考视频生成","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"happyhorse-1.0-video-edit","displayName":"HappyHorse 1.0 视频编辑","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"wan2.7-t2v-2026-06-12","displayName":"万相 2.7 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"wan2.7-i2v-2026-04-25","displayName":"万相 2.7 图生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"wan2.7-r2v-2026-06-12","displayName":"万相 2.7 参考视频生成","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"kling/kling-v3-omni-video-generation","displayName":"可灵 V3 Omni 视频生成","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"kling/kling-v3-video-generation","displayName":"可灵 V3 视频生成","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"pixverse/pixverse-c1-t2v","displayName":"爱诗 C1 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"pixverse/pixverse-v6-t2v","displayName":"爱诗 V6 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"pixverse/pixverse-v5.6-t2v","displayName":"爱诗 V5.6 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"pixverse/pixverse-c1-it2v","displayName":"爱诗 C1 图生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"pixverse/pixverse-v6-it2v","displayName":"爱诗 V6 图生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"pixverse/pixverse-v5.6-it2v","displayName":"爱诗 V5.6 图生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"vidu/viduq3-pro_text2video","displayName":"Vidu Q3 Pro 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"vidu/viduq3-turbo_text2video","displayName":"Vidu Q3 Turbo 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"vidu/viduq2_text2video","displayName":"Vidu Q2 文生视频","modelType":"video","supportedEndpointTypes":["video"]},
  {"id":"qwen-image-3.0-pro","displayName":"通义千问图像 3.0 Pro","modelType":"image","supportedEndpointTypes":["image"]},
  {"id":"wan2.7-image-pro","displayName":"万相图像 2.7 Pro","modelType":"image","supportedEndpointTypes":["image"]},
];

/** 主机名判定（与参考实现一致，只做后缀匹配，不做 DNS 解析） */
export function isBailianHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(String(baseUrl ?? '').trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'dashscope.aliyuncs.com' || host.endsWith('.dashscope.aliyuncs.com')) return true;
  if (host.startsWith('dashscope-') && host.endsWith('.aliyuncs.com')) return true;
  if (host === 'maas.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com')) return true;
  return false;
}

export const bailianDiscovery: ModelCatalogDiscovery = {
  providerId: 'bailian',
  match: (baseUrl) => isBailianHost(baseUrl),
  additionalModels: () => BAILIAN_MODELS.map((item) => ({ ...item })),
};
