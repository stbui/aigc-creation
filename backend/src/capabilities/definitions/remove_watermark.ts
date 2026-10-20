/**
 * 去除水印 —— 参考站 watermark-remove。清除水印与遮挡文字 (本地为模糊占位)。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';

export const RemoveWatermark: CapabilityPlugin = {
  id: 'remove_watermark',
  name: '去除水印',
  group: 'ai_retouch',
  summary: '清理图片中的水印与干扰标记。',
  sidebarHint: '智能去除图片中的水印与遮挡文字',
  badge: '免费',
  mode: 'mock',
  creditCost: 0, // 原页面标注「限时免费」，0 保留该语义
  help: '请仅处理你拥有版权或已获授权的图片',
  params: [
    {
      key: 'mode',
      label: '处理方式',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: '自动识别' },
        { value: 'region', label: '指定区域' },
      ],
    },
    { key: 'region', label: '区域位置', type: 'enum', default: 'bottom_right', options: [
      { value: 'bottom_right', label: '右下角' },
      { value: 'bottom_left', label: '左下角' },
      { value: 'top_right', label: '右上角' },
      { value: 'top_left', label: '左上角' },
      { value: 'center', label: '画面中央' },
    ] },
  ],
  buildPrompt: (p) =>
    `去除图片水印：${p.mode === 'auto' ? '自动识别并清除水印区域' : `清除${p.region || '指定区域'}的水印/遮挡文字`}，` +
    `修补处与周围质感一致，不留痕迹`,
  localImpl: 'makePlaceholder',
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
