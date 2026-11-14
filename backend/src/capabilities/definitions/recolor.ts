/**
 * 商品换色 —— 参考站 product-recolor。保持结构光影, 只换主体颜色。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { editImageIntent } from '../model-mapping';
import { BG_COLOR_OPTIONS, QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const Recolor: CapabilityPlugin = {
  id: 'recolor',
  name: '商品换色',
  group: 'ai_retouch',
  summary: '快速替换商品颜色，丰富展示版本。',
  sidebarHint: '保持商品结构不变，快速替换主体颜色',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'color', label: '商品颜色', type: 'enum', default: '#FFFFFF', options: BG_COLOR_OPTIONS.slice(1) },
    {
      key: 'customColor',
      label: '自定义颜色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      pattern: '^#[0-9a-fA-F]{6}$',
      help: '仅当商品颜色选择"自定义颜色"时生效',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /** 参考站 createTemplateImageTool 直接提交解析后的 HEX；旧 color/customColor 继续兼容。 */
    {
      key: 'targetColor',
      label: '目标颜色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      hidden: true,
      pattern: '^#[0-9a-fA-F]{6}$',
    },
  ],
  buildPrompt: (p) => {
    /*
     * targetColor 是定制页提交的最终 HEX；color/customColor 是旧调用方的
     * 兼容字段。选择 custom 时必须把 customColor 解析出来，否则提示词会变成
     * “换成 custom”，模型无法知道要换什么颜色。
     *
     * 措辞复用 main_image.ts / sku_image.ts 的商品一致性与文案硬约束，
     * 避免换色单独维护一套口径。比例 / 画质只走协议字段：这里不写具体比例
     * 数值，也不再声称「画面尺寸全部不变」—— 改画幅时那是做不到的，只会
     * 让后台「查看提示词」显示的比例与提示词自相矛盾。
     */
    const targetColor =
      p.targetColor || (p.color === 'custom' ? p.customColor : p.color) || '#FFFFFF';
    return [
      `商品换色：以输入图中的商品为基准，只把该商品的主色区域替换为 ${targetColor}，生成同一件商品的换色版本。`,
      '只替换主色面料 / 主体着色区域，保留原有的色块分区、拼色结构、印花、缝线、渐变与装饰细节，不把整件商品平涂成单一颜色；金属件、透明件、logo、装饰件与背景保留原色。',
      '必须保持同一件商品：商品类别、外形轮廓、数量、部件与结构、材质纹理、图案、视角、姿态与遮挡关系全部不变；不得新增、移除或替换任何物体，不得改画成其他品类，不得拉伸变形或增删部件。',
      '高光、反光与阴影的位置和明暗关系保持不变，色相随新颜色自然过渡，保留褶皱与曲面上的明暗梯度，不留原色边缘、色斑或光晕。',
      '图中已有文字、logo、价格、参数和标签保持原样，不重写、不翻译、不美化、不遮挡；不新增价格、优惠、销量、认证、功效、参数、品牌标识或行动号召，不复制水印、二维码、平台界面或他人品牌元素；成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案。',
      '保持输入图的光线风格、背景类型与商品在画面中的位置和构图；请求画幅与输入图不同时只做最小范围补边或裁切适配，外扩区域延续原背景风格，不拉伸商品和背景。',
      '只输出一张与输入图同一商品、同一画面的换色成图，不输出拼图、多色卡、前后对照图或多版本合集，不重新创作相似风格的新图。',
    ].join('\n');
  },
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: editImageIntent },
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
