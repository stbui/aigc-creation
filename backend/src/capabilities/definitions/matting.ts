/**
 * 一键抠图 —— 参考站 background-remove。分离主体与背景, 支持换底色。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { editImageIntent } from '../model-mapping';
import { BG_COLOR_OPTIONS, MATTING_COLOR_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const Matting: CapabilityPlugin = {
  id: 'matting',
  name: '一键抠图',
  group: 'ai_retouch',
  summary: '快速去除背景，突出商品主体。',
  sidebarHint: '智能识别主体，一键去除图片背景',
  badge: '免费',
  mode: 'real',
  creditCost: 0, // 原页面标注「限时免费」，0 保留该语义；限时结束改价即可恢复
  params: [
    { key: 'bgColor', label: '背景颜色', type: 'enum', default: 'transparent', options: BG_COLOR_OPTIONS },
    {
      key: 'customColor',
      label: '自定义背景色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      pattern: '^#[0-9a-fA-F]{6}$',
      help: '仅当背景颜色选择"自定义颜色"时生效',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    /*
     * 2026-10-25 对齐参考站 createBackgroundRemoval 的字段名；2026-11-14
     * 提示词审核后改为纯前端合成参数。
     *
     * 页面代填 selectedColor，旧调用方仍可继续传 bgColor。这四个颜色字段
     * 只供结果编辑器在浏览器合成背景、后台重建任务参数时使用，**不进入
     * 提示词** —— 抠图模型只产出透明主体（见 MattingResultEditor 组件头
     * 注释）。selectedColor / customAlpha 声明为 hidden，旧调用方未提交时
     * 不能被默认值补上，否则会覆盖 bgColor（见 sanitizeParams）。
     */
    {
      key: 'selectedColor',
      label: '背景颜色（参考站字段）',
      type: 'enum',
      default: 'transparent',
      options: MATTING_COLOR_OPTIONS,
      hidden: true,
    },
    {
      key: 'customAlpha',
      label: '自定义背景透明度（%）',
      type: 'number',
      default: 100,
      min: 0,
      max: 100,
      step: 1,
      hidden: true,
    },
    {
      key: 'resolution',
      label: '输出分辨率（参考站字段）',
      type: 'text',
      hidden: true,
      help: '参考站 createBackgroundRemoval 的 resolution；与 size 同义，页面代填',
    },
  ],
  /*
   * 2026-11-14 提示词审核修订：模型只负责产出「带 Alpha 通道的透明主体」，
   * 背景色 / 自定义透明度由 MattingResultEditor 在浏览器本地合成（组件头
   * 注释已明确这一分工）。旧文案把 selectedColor 的 token 名（white /
   * light-blue）当色值发给模型，又把前端 canvas 的 customAlpha 写成
   * 「透明度 72%」元指令：模型拿不到色值，还可能输出不透明底图，使前端
   * fillRect 的背景色被结果图整体覆盖。现删除全部背景色 / alpha 指令，
   * 颜色参数只用于前端合成与后台溯源，不再进入提示词。
   *
   * 硬约束措辞复用 main_image.ts:236-242 / sku_image.ts:299-303 /
   * recolor.ts:57-65，不自造一套口径；比例与分辨率仍只走协议字段。
   */
  buildPrompt: (_params, refCount = 0) =>
    [
      '商品抠图：以输入图中的商品为唯一主体，精确分离主体与背景，输出带 Alpha 通道的透明背景图；主体外区域完全透明，不绘制任何背景、底色、投影或场景。',
      '边缘发丝级保留，半透明区域按原图透明度过渡，不留白边、黑边、锯齿、光晕或原背景残影；主体完整不裁切。',
      '必须保持同一件商品：商品类别、外形轮廓、数量、部件与结构、颜色、材质纹理、图案、logo、包装、视角、姿态与遮挡关系全部与输入图一致；不得重绘、替换、拉伸变形或增删部件，不得新增、移除或替换任何物体。',
      '图中已有文字、logo、价格、参数和标签保持原样，不重写、不翻译、不美化、不遮挡；不新增价格、优惠、销量、认证、功效、参数、品牌标识或行动号召，不复制水印、二维码、平台界面或他人品牌元素；成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案。',
      '参考图只作为主体外观与轮廓依据，不作为背景、场景、版式或文案参考；不复制参考图的背景、桌面、人物、构图与水印，只移除背景、保留主体。',
      '只输出一张透明底主体图，不输出白底图、带色底图、拼图、前后对照图或多版本合集；不重新创作相似风格的新图，不把抠图结果放进任何新场景。',
      ...(refCount > 0 ? [`共参考上传的 ${refCount} 张商品图。`] : []),
    ].join('\n'),
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: editImageIntent },
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
