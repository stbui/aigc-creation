/**
 * 局部重绘 —— 参考站 local-redraw。只重绘指定区域, 其余像素不变。
 * 必须由真实 inpainting 模型完成。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

/** 参考图动态描述的合计上限：描述是增强信息，不能挤掉主修改要求。 */
const MAX_REFERENCE_HINT_CHARS = 1600;

/** 与页面上的 3 条描述位一致；超出部分不进入提示词，也不触发参考图解析。 */
export const MAX_LOCAL_REDRAW_ANNOTATIONS = 3;

/** 参考站 createInpainting 的标注项（前端以 JSON 字符串提交）。 */
interface InpaintingAnnotation {
  annotationId: string;
  label: string;
  instruction: string;
  /** 该标注单独上传的参考图素材 id（执行期转成文字描述后并入提示词）。 */
  referenceAssetId?: string | null;
}

/**
 * 把页面代填的 annotations JSON 解析成**可直接用于拼提示词**的数组。
 *
 * 外部接口不能假设 payload 一定来自本页面：instruction 可能是数字、
 * 数组里可能混入 null、也可能一次塞几百条。这里统一裁剪成最多 3 条
 * 非空字符串标注 —— 否则 `(instruction ?? '').trim()` 会在数字上直接抛
 * TypeError，把一次生成变成 500。
 */
export function parseLocalRedrawAnnotations(raw: unknown): InpaintingAnnotation[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const annotations: InpaintingAnnotation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : '';
    if (!instruction) continue;

    const rawLabel = typeof record.label === 'string' ? record.label.trim() : '';
    const rawAnnotationId = typeof record.annotationId === 'string' ? record.annotationId.trim() : '';
    const referenceAssetId =
      typeof record.referenceAssetId === 'string' && record.referenceAssetId.trim()
        ? record.referenceAssetId.trim()
        : null;
    annotations.push({
      annotationId: rawAnnotationId || String(annotations.length + 1),
      label: rawLabel || `标注${annotations.length + 1}`,
      instruction,
      referenceAssetId,
    });
    if (annotations.length >= MAX_LOCAL_REDRAW_ANNOTATIONS) break;
  }
  return annotations;
}

export const LocalRedraw: CapabilityPlugin = {
  id: 'local_redraw',
  name: '局部重绘',
  group: 'ai_retouch',
  summary: '精准修改画面中需要调整的区域。',
  sidebarHint: '局部涂抹后，通过文字描述重绘指定区域',
  mode: 'real',
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
      help: '在画布上涂抹圈选；未涂抹时按位置文字描述（仅影响提示词，遮罩才是重绘依据）',
    },
    { key: 'prompt', label: '这个区域改成什么？', type: 'text', placeholder: '例如：把包装盒改成哑光材质' },
    /*
     * 遮罩素材 id —— **页面代填**的技术参数（画布涂抹后上传的 PNG）。
     *
     * 必须声明: sanitizeParams 只保留声明过的 key, 不声明就会被静默丢弃,
     * 任务照常整图重绘而用户以为只改了涂抹区。hidden 让通用工具页不渲染它。
     */
    {
      key: 'maskAssetId',
      label: '遮罩素材',
      type: 'text',
      hidden: true,
      help: '由画布涂抹生成并上传, 不需要手填',
    },
    {
      key: 'modelGuideAssetId',
      label: '模型引导素材',
      type: 'text',
      hidden: true,
      help: '参考站 createInpainting 的模型引导图 id；与 maskAssetId 同义，页面代填',
    },
    {
      key: 'annotations',
      label: '标注数组',
      type: 'text',
      hidden: true,
      maxLength: 10000,
      help: 'JSON 字符串：[{annotationId,label,instruction}]，由页面代填',
    },
    {
      key: 'strength',
      label: '重绘强度',
      type: 'number',
      hidden: true,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      help: '参考站 strength=brushSize/60；当前图像通道暂未消费，仅按协议留存',
    },
    {
      key: 'outputCount',
      label: '输出张数',
      type: 'number',
      default: 1,
      min: 1,
      max: 1,
      step: 1,
      hidden: true,
      help: '参考站 createInpainting 固定单张输出；保留字段以兼容其请求契约',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    {
      key: 'imageRatio',
      label: '画面比例（参考站字段）',
      type: 'text',
      hidden: true,
      help: '参考站 createInpainting 仅在非原比例时提交；与 ratio 同义',
    },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  /*
   * 有遮罩时提示词说「遮罩区域」, 不再拿位置枚举冒充圈选 ——
   * 遮罩才是模型的重绘依据, 位置枚举只用于没有遮罩时的文字兜底。
   */
  buildPrompt: (p) => {
    const area = p.modelGuideAssetId || p.maskAssetId ? '遮罩圈定的区域' : p.region || '指定区域';
    const annotations = parseLocalRedrawAnnotations(p.annotations);
    const referenceHints = Array.isArray(p.__referenceHints)
      ? p.__referenceHints.filter((item: unknown): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
    const referenceText = referenceHints.join('；').slice(0, MAX_REFERENCE_HINT_CHARS);
    const hintText = referenceText ? `；参考图描述：${referenceText}` : '';
    if (annotations.length > 0) {
      const requirements = annotations
        .map((item) => `${item.label}：${item.instruction}`)
        .join('；');
      return `局部重绘：只重绘${area}，其余像素保持不变。修改要求：${requirements || '按描述局部修改'}${hintText}${p.imageRatio ? `；输出比例 ${p.imageRatio}` : ''}`;
    }
    return `局部重绘：只重绘${area}，其余像素保持不变。修改要求：${p.prompt || '按描述局部修改'}${hintText}${p.imageRatio ? `；输出比例 ${p.imageRatio}` : ''}`;
  },
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
