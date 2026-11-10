/**
 * 写真模板 —— 上传人物照片，选择婚纱写真模板，生成同款风格的人像成片。
 *
 * 2026-11-10 新增。模板清单与提示词的事实源在 `template.templates.ts`，
 * 由 `GET /template/templates` 下发；前端只做分类筛选与渲染。
 *
 * 生成链路与站内其它图像能力同源：上传照片作为人物身份参考，模板的
 * `prompt` 作为场景 / 服装 / 光影指令，一起进入模型请求。没有可用线路时
 * 任务失败并退款，不回落本地占位图。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { generateImageIntent } from '../model-mapping';
import { QUALITY_OPTIONS, ratioText, sizeText } from './param-options';
import { portraitTemplate } from './template.templates';

/** 人像比例档位（婚纱写真以竖版为主，默认 3:4）。 */
const PORTRAIT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:5', label: '4:5' },
  { value: '9:16', label: '9:16' },
];

/** 模板缺失时的兜底描述：正常情况下不会走到，但提示词不能是空串。 */
const FALLBACK_STYLE =
  '自然光婚纱写真：干净背景、柔和肤色、真实礼服质感，构图突出人物情绪与姿态。';

export const Template: CapabilityPlugin = {
  id: 'template',
  name: '写真模板',
  group: 'ecommerce_gen',
  summary: '上传人物照片，选一张婚纱写真模板，生成同款风格大片。',
  sidebarHint: '上传照片、选模板，生成婚纱写真',
  mode: 'real',
  creditCost: 10,
  params: [
    /*
     * 模板 id 声明为 text 而非 enum：模板库会持续扩充，塞进
     * `GET /capabilities` 的 options 会让能力清单接口随模板数线性膨胀。
     * 合法性由 `validateCapabilityParams` 的跨字段校验兜住 ——
     * 传一个不存在的 id 会在扣费前返回 40001，而不是静默生成另一套风格。
     */
    { key: 'templateId', label: '模板', type: 'text', hidden: true, maxLength: 64 },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '3:4', options: PORTRAIT_RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '2k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p, refCount) => {
    const template = portraitTemplate(p.templateId);
    const name = template?.name ?? '婚纱写真';
    const style = template?.prompt ?? FALLBACK_STYLE;
    const references = Math.max(0, refCount);
    const subject = references > 1 ? `上传的 ${references} 张照片` : '上传的照片';

    return [
      `婚纱写真生成，采用「${name}」模板：${style}`,
      `以${subject}中的人物为主体，保持五官、脸型、发型、肤色与体型特征一致，不换人、不改变身份；`,
      '只替换场景、服装、造型与光影，构图按模板描述重新设计，输出单张竖版人像；',
      '画面真实自然，可作为婚纱写真成片，不出现品牌 logo、文字水印与多余装饰',
      `${ratioText(p.ratio)}${sizeText(p.size)}。`,
    ].join('');
  },
  modality: 'image',
  model: {
    capability: 'image',
    operation: 'image_to_image',
    intent: generateImageIntent,
  },
  inputs: 1,
  /** 同一人物最多 5 张参考照片；服务端同样拒绝超额提交。 */
  maxInputs: 5,
  /** 上传照片是人物身份参考，不是待编辑底图。 */
  inputImageMode: 'reference',
  inWorkbench: true,
  help: '至少上传 1 张清晰人像；模板提示词会连同照片一起发送给模型。',
};
