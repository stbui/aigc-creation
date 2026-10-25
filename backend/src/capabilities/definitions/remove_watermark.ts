/**
 * 去除水印 —— 参考站 watermark-remove。
 *
 * 必须由真实图像编辑模型完成。压在商品主体上的水印需要生成式重绘，
 * 不再提供本地近似修补。
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
  mode: 'real',
  creditCost: 0, // 原页面标注「限时免费」，0 保留该语义
  help: '请仅处理你拥有版权或已获授权的图片；压在商品主体上的水印建议走云端通道',
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
    /*
     * 2026-10-25 对齐参考站 createWatermarkRemoval：
     * 手动涂抹/框选生成的 PNG 以素材 id 提交。遮罩语义与局部重绘一致：
     * 透明像素 = 要去除的区域。声明为 hidden，避免通用工具页要求用户手填 UUID。
     */
    { key: 'maskAssetId', label: '遮罩素材', type: 'text', hidden: true },
    { key: 'detectionMode', label: '检测方式', type: 'enum', default: 'MANUAL', options: [
      { value: 'MANUAL', label: '手动标注' },
      { value: 'AUTO', label: '自动识别' },
    ], hidden: true },
    {
      key: 'outputFormat',
      label: '输出格式（参考站字段）',
      type: 'enum',
      default: 'PNG',
      options: [
        { value: 'PNG', label: 'PNG' },
        { value: 'JPEG', label: 'JPEG' },
      ],
      hidden: true,
    },
  ],
  buildPrompt: (p) =>
    `去除图片水印：${p.maskAssetId ? '清除遮罩圈定的水印区域' : p.mode === 'auto' ? '自动识别并清除水印区域' : `清除${p.region || '指定区域'}的水印/遮挡文字`}，` +
    `修补处与周围质感一致，不留痕迹`,
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
