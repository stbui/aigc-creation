/**
 * 局部重绘 —— 参考站 local-redraw。只重绘指定区域, 其余像素不变 (本地为占位)。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const LocalRedraw: CapabilityPlugin = {
  id: 'local_redraw',
  name: '局部重绘',
  group: 'ai_retouch',
  summary: '精准修改画面中需要调整的区域。',
  sidebarHint: '局部涂抹后，通过文字描述重绘指定区域',
  mode: 'mock',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    {
      key: 'region',
      label: '重绘区域',
      type: 'enum',
      default: 'center',
      options: [
        { value: 'center', label: '画面中心' },
        { value: 'top', label: '画面上方' },
        { value: 'bottom', label: '画面下方' },
        { value: 'left', label: '画面左侧' },
        { value: 'right', label: '画面右侧' },
        { value: 'full', label: '整图重绘' },
      ],
      help: '参考站在画布上涂抹圈选, 本地以位置枚举代替涂抹区域',
    },
    { key: 'prompt', label: '这个区域改成什么？', type: 'text', placeholder: '例如：把包装盒改成哑光材质' },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) =>
    `局部重绘：只重绘${p.region || '指定区域'}，其余像素保持不变。修改要求：${p.prompt || '按描述局部修改'}`,
  localImpl: 'makeLocalRedraw',
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
