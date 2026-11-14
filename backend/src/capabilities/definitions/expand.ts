/**
 * 智能扩图 —— 参考站 image-expand。向外延展画面并自然补全。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { editImageIntent } from '../model-mapping';
import {
  EXPAND_POSITIONS,
  QUALITY_OPTIONS,
  RATIOS_WITH_ORIGINAL,
  optionLabel,
} from './param-options';

export const Expand: CapabilityPlugin = {
  id: 'expand',
  name: '智能扩图',
  group: 'ai_retouch',
  summary: '自然补全画面边缘与展示空间。',
  sidebarHint: '智能补全画面边缘，扩展图片构图',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'occupy', label: '原图占比（%）', type: 'number', default: 80, min: 1, max: 100, step: 1 },
    { key: 'position', label: '原图位置', type: 'enum', default: 'center', options: EXPAND_POSITIONS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /*
     * 参考站 SMART_EXPAND 的定位字段（均相对目标画布 0..1），由页面按
     * occupy + position + 源图尺寸推导后提交，作为任务参数快照保留。
     *
     * ⚠️ 诚实披露：buildPrompt 与模型请求当前都不消费这四个字段，构图只由
     * 提示词里的「占比 + 中文位置」定性表达，预览盒与模型产出不保证像素级
     * 一致。要按几何精确落点须先裁定落地方式（见 docs/gen-prompt.md §10），
     * 不要在提示词里自造坐标语义。
     */
    { key: 'placementX', label: '原图 X（0-1）', type: 'number', min: 0, max: 1, step: 0.001, hidden: true },
    { key: 'placementY', label: '原图 Y（0-1）', type: 'number', min: 0, max: 1, step: 0.001, hidden: true },
    { key: 'placementWidth', label: '原图宽（0-1）', type: 'number', min: 0.01, max: 1, step: 0.001, hidden: true },
    { key: 'placementHeight', label: '原图高（0-1）', type: 'number', min: 0.01, max: 1, step: 0.001, hidden: true },
    /*
     * 仅作参考站字段快照：比例由 ratio → 意图 size → 协议 aspectRatio 下发，
     * 不进提示词。带数字比例白名单，与 rotate.imageRatio 同口径，避免任意
     * 自由文本经 hidden 字段注入提示词。
     */
    { key: 'targetImageRatio', label: '目标画幅（参考站字段）', type: 'text', hidden: true, pattern: '^[0-9]+:[0-9]+$' },
  ],
  /*
   * 2026-11-14 审核整改：原模板把英文枚举键（top-left / center / original）
   * 直接拼进中文句子，并重复声明由协议字段下发的画幅，见 docs/gen-prompt.md §10。
   * 措辞复用 recolor.ts / rotate.ts 的商品一致性、文字品牌与输出唯一性段落，
   * 不单独维护一套口径。比例 / 画质仍只走协议字段。
   */
  buildPrompt: (p) => {
    const rawOccupy = Number(p.occupy);
    const occupy = Number.isFinite(rawOccupy) && rawOccupy > 0 ? rawOccupy : 80;
    const position = optionLabel(EXPAND_POSITIONS, p.position || 'center');
    return [
      `智能扩图：以输入图为底图，把原图作为一个整体按原比例放进更大的目标画布，原图占比约 ${occupy}%；原图位置：${position}。只在原图四周新扩出的边缘区域补全背景，不拉伸、不裁切、不改动原图已有的像素内容。`,
      '补全区域延续原图的背景类型、色调、光线方向、阴影、透视与景深，边缘过渡自然；不得出现拼接缝隙、色差、亮度断层或边界光晕，不得扩展成与输入图无关的新场景。',
      '必须保持输入图中的同一件商品及其数量；商品类别、外形轮廓、结构部件、颜色、材质纹理、图案、logo、包装与可见配件、视角、姿态与遮挡关系全部不变；不得替换商品、拉伸变形、增删部件，不得在补全区域复制或新增第二个商品主体、人物、道具或无关物体。',
      '图中已有文字、logo、价格、参数和标签保持原样，不重写、不翻译、不美化、不遮挡；补全区域不得新增任何文字、数字、logo、价格标签、水印、二维码、平台界面或他人品牌元素，不新增价格、优惠、销量、认证、功效、参数或行动号召；成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案。',
      '只输出一张完整的扩图成图，不输出拼图、前后对照图、多版本合集或重新创作的相似风格新图。',
    ].join('\n');
  },
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: editImageIntent },
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
