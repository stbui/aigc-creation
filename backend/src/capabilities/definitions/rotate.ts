/**
 * 旋转角度 —— 参考站 rotate-angle。三滑块(旋转/倾斜/缩放)改变展示视角。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const Rotate: CapabilityPlugin = {
  id: 'rotate',
  name: '旋转角度',
  group: 'ai_retouch',
  summary: '调整商品展示角度，补全视觉构图。',
  sidebarHint: '调整商品展示视角，生成新的观察角度',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'yaw', label: '旋转（水平角）', type: 'number', default: 0, min: -90, max: 90, step: 1 },
    { key: 'pitch', label: '倾斜（俯仰角）', type: 'number', default: 0, min: -30, max: 60, step: 1 },
    { key: 'zoom', label: '缩放', type: 'number', default: 1, min: 0.8, max: 1.2, step: 0.01 },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /* 参考站 VIEW_ROTATION 的字段名；页面按主体/摄像头方向换算后同时提交，旧 yaw/pitch/zoom 兼容。 */
    { key: 'azimuthDeg', label: '方位角（参考站字段）', type: 'number', min: -90, max: 90, step: 1, hidden: true },
    { key: 'elevationDeg', label: '俯仰角（参考站字段）', type: 'number', min: -30, max: 60, step: 1, hidden: true },
    { key: 'zoomFactor', label: '缩放系数（参考站字段）', type: 'number', min: 0.8, max: 1.2, step: 0.01, hidden: true },
    /* 参考站 VIEW_ROTATION 仅在非原比例时提交 imageRatio。 */
    { key: 'imageRatio', label: '画面比例（参考站字段）', type: 'text', hidden: true },
  ],
  buildPrompt: (p) =>
    `改变商品展示视角：水平旋转 ${p.azimuthDeg ?? p.yaw ?? 0}°、` +
    `俯仰 ${p.elevationDeg ?? p.pitch ?? 0}°、缩放 ${p.zoomFactor ?? p.zoom ?? 1}，` +
    `按新视角重建商品展示，背景保持不变${p.imageRatio ? `；输出比例 ${p.imageRatio}` : ''}`,
  localImpl: 'makeRotate',
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
