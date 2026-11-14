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
import { editImageIntent } from '../model-mapping';

/**
 * 区域枚举 value → 中文画面描述。
 *
 * `region` 声明的是内部 key（bottom_right 等），此前被原样拼进中文提示词，
 * 实发文本会出现「清除bottom_right的水印」。未知值一律回落「指定区域」，
 * 不把外部文本带进画面要求（`sanitizeParams` 的 enum 白名单是第一道闸，
 * 这里兜住历史脏数据与后台重建）。
 */
const REGION_LABELS: Record<string, string> = {
  bottom_right: '右下角',
  bottom_left: '左下角',
  top_right: '右上角',
  top_left: '左上角',
  center: '画面中央',
};

function regionLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '指定区域';
  return REGION_LABELS[raw] ?? '指定区域';
}

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
  /*
   * 遮罩是唯一编辑依据：页面强制上传遮罩，有遮罩时不再拿 mode / region 的
   * 位置描述冒充圈选。区域边界与商品一致性复用 local_redraw.ts /
   * matting.ts，文字与品牌硬约束复用 main_image.ts / sku_image.ts /
   * recolor.ts，避免去水印单独维护一套口径。
   *
   * 比例 / 画质只走协议字段，不写进提示词。参考站抓取未捕获
   * createWatermarkRemoval 的请求体，以下是按本仓既有硬约束补齐的画面约束，
   * 不是与上游提示词的 1:1 文案对照。
   */
  buildPrompt: (p) => {
    let target = `画面${regionLabel(p.region)}的水印与遮挡文字`;
    if (p.maskAssetId) target = '遮罩圈定的水印区域';
    else if (p.mode === 'auto') target = '自动识别出的水印区域';
    return [
      `去除图片水印：以输入图为底图，只清除${target}，输出同一张图的去水印版本。`,
      '清除范围以遮罩或上述指定区域为限；范围外的像素、构图、背景与光线保持不变，不做整图重绘、不重新创作相似风格的新图。',
      '按区域周边的纹理、材质、光照、阴影与景深自然延续修补，与周围质感一致；不留水印残影、重影、色斑、光晕、模糊块或拼接痕迹。',
      '商品结构、颜色、材质、纹理、logo、包装与可见配件必须与输入图一致；不得替换商品、改变比例、拉伸变形或增删部件；不得新增、移除或替换任何物体。',
      '图中已有文字、logo、价格、参数和标签保持原样，不重写、不翻译、不美化、不遮挡；商品本体上的商标、品牌标识与合规标签不属于水印，不得一并清除；不新增价格、优惠、销量、认证、功效、参数、品牌标识或行动号召，不复制水印、二维码、平台界面或他人品牌元素；成图不得出现错字、乱码、重复主体或装饰性假文案。',
      '只输出一张与输入图同一画面的成图，不输出拼图、前后对照图或多版本合集。',
    ].join('\n');
  },
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: editImageIntent },
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
