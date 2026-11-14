/**
 * 产品精修 —— 参考站 product-retouch。优化质感与细节, 6 种精修模式。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 *
 * 2026-11-14 提示词修订: 上游 `createTemplateImageTool('PRODUCT_REFINEMENT')` 的
 * `templateCode` 是服务端模板 ID（见 reference/ijihua/index.js 的 Lg 映射），由上游
 * 展开成各模式自己的提示词；本地没有模板系统。旧实现把模板码当自然语言写进提示词，
 * 6 个模式除代号外逐字相同 —— 等于选了模板却没实现模板内容。现改为按 `mode` 生成
 * 6 条差异化画面要求；模板码 / additionalRequirement / imageRatio 仍是参考站契约
 * 字段，只留在参数快照里，不进入提示词（比例由协议字段下发）。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { editImageIntent } from '../model-mapping';
import { QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL, RETOUCH_MODES } from './param-options';

/**
 * 6 个模式各自的画面目标。
 *
 * 只把参考站 pill 的中文名复述成动作句，并用「只… / 不额外改变…」保证互斥。
 * 色彩校正是否允许改白平衡、材质强化是否允许改变材质观感一类细粒度口径属产品
 * 决策，这里用中性措辞收敛，待裁定后再调整，不自造语义。
 */
const MODE_GOAL: Record<string, string> = {
  comprehensive:
    '整体优化商品质感、清晰度与画面细节，兼顾去除可见脏污与轻微瑕疵、理顺明暗与色彩观感，让商品呈现更干净通透。',
  texture:
    '只增强商品表面质感的呈现：纹理层次、光影过渡与细腻度，保留原有纹理走向；不额外改动画面色彩与锐度，也不承担去瑕疵。',
  blemish:
    '只去除商品表面的划痕、指纹、灰尘、污点与拍摄噪点，按周围原有纹理自然补齐；不改变商品的颜色、材质、光泽与清晰度。',
  color:
    '只针对画面色彩观感做校正，让商品颜色更接近真实、整体明暗更协调；不改变商品固有色与配色分区，不额外改变清晰度、质感与去瑕疵处理。',
  clarity:
    '只提升主体边缘锐度与细节可读性，不产生过度锐化的白边、光晕或臆造的伪细节；不额外改变色彩、质感与曝光。',
  material:
    '只强化商品材质的表现力：金属、皮革、玻璃、织物等材质的光泽、纹理与厚度感，保留原有明暗关系；不替换材质种类、不新增材质，不额外改变色彩与清晰度。',
};

/** 模式化的一致性边界：避免「保持颜色真实」与色彩校正等目标互相矛盾。 */
const MODE_BOUNDARY: Record<string, string> = {
  comprehensive:
    '材质种类、纹理走向、固有色与配色分区保持不变；高光、反光与阴影的位置和明暗关系不变，只做整体观感优化。',
  texture:
    '材质种类、纹理走向、固有色与配色分区保持不变；允许调整表面光影的细腻度，但不得改变明暗关系与光源方向。',
  blemish:
    '材质种类、纹理走向、固有色与配色分区保持不变；修复区域必须与周围纹理自然衔接，不得留下补绘痕迹或改变明暗关系。',
  color:
    '材质种类与纹理走向不变；允许整体色彩观感与明暗归一，固有色与配色分区不得改变，不得把一种颜色换成另一种颜色；高光、反光与阴影的位置不变。',
  clarity:
    '材质种类、纹理走向、固有色与配色分区保持不变；锐化只作用于已有细节，不得改变明暗关系或新增细节。',
  material:
    '固有色与配色分区不变；允许调整材质表面的光泽与明暗表现，材质种类与纹理走向不得改变，不得把一种材质换成另一种材质。',
};

export const Enhance: CapabilityPlugin = {
  id: 'enhance',
  name: '产品精修',
  group: 'ai_retouch',
  summary: '优化商品细节与材质质感。',
  sidebarHint: '优化商品质感与画面细节，提升展示效果',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'mode', label: '精修模式', type: 'enum', default: 'comprehensive', options: RETOUCH_MODES },
    {
      key: 'note',
      label: '补充要求（选填）',
      type: 'text',
      maxLength: 200,
      placeholder: '如：去掉电镀件上的指纹，让皮革看起来更有光泽',
      help: '作为独立的「补充要求」区块写入模型提示词，与一致性约束冲突时以约束为准',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /*
     * 参考站 createTemplateImageTool('PRODUCT_REFINEMENT') 的模板码。上游是服务端
     * 模板 ID，本地没有模板系统：这里只作为任务参数快照 / 溯源元数据保留，提示词
     * 统一按 mode 生成，不再把代号当自然语言发给模型。
     */
    {
      key: 'templateCode',
      label: '精修模板（参考站字段）',
      type: 'enum',
      default: 'IT_PR_COMPREHENSIVE',
      options: [
        { value: 'IT_PR_COMPREHENSIVE', label: '综合精修' },
        { value: 'IT_PR_TEXTURE', label: '质感增强' },
        { value: 'IT_PR_DEFECT_REPAIR', label: '瑕疵修复' },
        { value: 'IT_PR_COLOR_CORRECTION', label: '色彩校正' },
        { value: 'IT_PR_CLARITY', label: '提升清晰度' },
        { value: 'IT_PR_MATERIAL', label: '材质强化' },
      ],
      hidden: true,
    },
    /* 参考站 parameters.additionalRequirement；与 note 同源，两个字段名都认。 */
    {
      key: 'additionalRequirement',
      label: '补充要求（参考站字段）',
      type: 'text',
      maxLength: 200,
      hidden: true,
    },
    /*
     * 参考站 PRODUCT_REFINEMENT 仅在非原比例时提交 imageRatio。比例由 `ratio` 经
     * 意图 size → aspectRatio 下发，不进提示词（写进去是元指令，可能被当成画面
     * 内容）；这里保留字段只为对齐参考站契约，并挡住任意文本注入。
     */
    {
      key: 'imageRatio',
      label: '画面比例（参考站字段）',
      type: 'text',
      hidden: true,
      pattern: '^[0-9]+:[0-9]+$',
    },
  ],
  /**
   * 提示词按 `mode` 生成，模板码不参与 —— 外部传错 templateCode 也不会让
   * 「选 A 得到 B」。未知 mode 回落到综合精修（更安全的一侧）。
   * 用户输入放在独立的补充要求区块并声明优先级，不混入结构性指令。
   */
  buildPrompt: (p, refCount) => {
    const rawMode = String(p?.mode ?? '');
    const mode = MODE_GOAL[rawMode] ? rawMode : 'comprehensive';
    const label = RETOUCH_MODES.find((option) => option.value === mode)?.label ?? '综合精修';
    const note = String(p?.additionalRequirement || p?.note || '').trim();
    const base = refCount > 0 ? '以输入图为底图，' : '';

    return [
      `产品精修（${label}）：${base}${MODE_GOAL[mode]}`,
      '必须保持同一件商品：商品类别、外形轮廓、数量、部件与结构、图案、视角、姿态与遮挡关系全部不变；不得新增、移除或替换任何物体，不得改画成其他品类，不得拉伸变形或增删部件。',
      MODE_BOUNDARY[mode],
      ...(note
        ? [
            `补充要求（仅用于理解本次精修重点，不得渲染成文字）：<<<${note}>>>。若补充要求与上述一致性约束冲突，以一致性约束为准；不得据此替换商品、重绘背景或新增画面元素。`,
          ]
        : []),
      '图中已有文字、logo、价格、参数和标签保持原样，不重写、不翻译、不美化、不遮挡；不新增价格、优惠、销量、认证、功效、参数、品牌标识或行动号召，不复制水印、二维码、平台界面或他人品牌元素；成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案。',
      '保持输入图的光线风格、背景类型与商品在画面中的位置和构图；请求画幅与输入图不同时只做最小范围补边或裁切适配，外扩区域延续原背景风格，不拉伸商品和背景。',
      '只输出一张与输入图同一商品、同一画面的精修成图，不输出拼图、前后对照图或多版本合集，不重新创作相似风格的新图。',
    ].join('\n');
  },
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: editImageIntent },
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
