/**
 * AI 带货图文 —— 参考站 shoppable-carousel。上传商品图, 选模板 + 卖点文案, 批量出图文套图。
 *
 * 2026-11-03 新增。参考站实拍见 `docs/shoppable-carousel-design.md`,
 * 模板数据与来源见 `docs/shoppable-carousel-template-sources.md`。
 *
 * ## 与其它能力的差别：一次提交出 N 张「图文」
 *
 * 参考站的产出不是单张图, 而是**一组带文案的图文**（参考站一次 6–10 张）。
 * 本能力的展开方式与 `ProductKitPage` / `DetailImage` 保持同一套做法 ——
 * **不另起一套**: 能力声明 `outputPlan`, 由准入层 (`task-admission.service.ts`)
 * 把一次提交拆成 N 个独立任务, 每张各建一张账单、各扣一份 `creditCost`,
 * 失败/取消按自己的账单退款, 共享同一个 `batchId` 供前端聚合成「一次生成」。
 *
 * ## 张数与模板拍数的关系（严格对齐参考站）
 *
 * 参考站的模板是**固定三拍**（如「开箱静物 → 多场景上身 → 细节收尾」）,
 * 但一次生成 6–10 张 —— 两者并不矛盾: 参考站是**按拍循环**出图。
 * 本能力照搬该口径: 第 k 张用第 `((k-1) % 3) + 1` 拍, 并在提示词里注明
 * 「本张为该模板第 N 拍」, 让同一模板的多个循环仍能看出层次差异。
 *
 * 参考站的步进器范围是 **6–10**（减号在 6 时禁用, 加号在 10 时禁用）, 本能力同口径。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { generateImageIntent } from '../model-mapping';
import {
  SHOPPABLE_CAROUSEL_CATEGORIES,
  SHOPPABLE_CAROUSEL_TEMPLATES,
  type ShoppableCarouselTemplate,
} from './shoppable-carousel.templates';
import { QUALITY_OPTIONS, RATIOS, ratioText, sizeText } from './param-options';

/** 一次生成的张数区间（参考站步进器实测: 6–10） */
export const SHOPPABLE_CAROUSEL_MIN_COUNT = 6;
export const SHOPPABLE_CAROUSEL_MAX_COUNT = 10;

/** 模板 id → 模板（提交时按 id 查回模板, 供提示词取 beats 与 promptFragment） */
const TEMPLATE_BY_ID = new Map<string, ShoppableCarouselTemplate>(
  SHOPPABLE_CAROUSEL_TEMPLATES.map((t) => [t.id, t]),
);

/**
 * 平台选项（参考站实拍: TikTok / 抖音 / 小红书 / Instagram, 默认 TikTok）。
 *
 * 与 `param-options.ts` 的 `PLATFORMS`（9 项电商投放平台）**不是同一组** ——
 * 参考站带货图文页的「平台」指的是**内容平台**（社媒发布去向）,
 * 不是商品上架的平台。两组不可合并, 否则下拉项会多出参考站没有的选项。
 */
const SOCIAL_PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'instagram', label: 'Instagram' },
];

/** 目标市场（参考站实拍 8 项, 默认美国） */
const TARGET_MARKETS = [
  { value: 'us', label: '美国' },
  { value: 'eu', label: '欧洲' },
  { value: 'cn', label: '中国' },
  { value: 'ru', label: '俄罗斯' },
  { value: 'sea', label: '东南亚' },
  { value: 'es', label: '西班牙' },
  { value: 'de', label: '德国' },
  { value: 'jp', label: '日本' },
];

/** 输出语言（参考站实拍 8 项, 默认英文） */
const OUTPUT_LANGUAGES = [
  { value: 'en', label: '英文' },
  { value: 'zh', label: '中文' },
  { value: 'ru', label: '俄语' },
  { value: 'es', label: '西语' },
  { value: 'de', label: '德语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'pt', label: '葡萄牙语' },
];

/**
 * 画面比例（参考站实拍 4 项: 1:1 / 4:5 / 9:16 / 3:4, 默认 3:4）。
 *
 * 不复用 `param-options.ts` 的 `RATIOS`（8 项）—— 参考站带货图文页只有这 4 档,
 * 且默认是 3:4 竖版（社媒图文惯例）。混用会让下拉多出 4 个参考站没有的档位。
 */
const CAROUSEL_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '9:16', label: '9:16' },
  { value: '3:4', label: '3:4' },
];

/** 枚举值 → 展示名 */
const labelOf = (options: Array<{ value: string; label: string }>, value: unknown): string =>
  options.find((o) => o.value === String(value ?? ''))?.label ?? String(value ?? '');

/** 分类码 → 展示名（提交时按模板的分类给提示词加限定词） */
const CATEGORY_LABEL = new Map(SHOPPABLE_CAROUSEL_CATEGORIES.map((c) => [c.id, c.label]));

/**
 * 模板 id → 模板对象。查不到时返回 `undefined`（提交会在准入层被参数校验拦下）。
 */
export function shoppableCarouselTemplate(id: unknown): ShoppableCarouselTemplate | undefined {
  return TEMPLATE_BY_ID.get(String(id ?? '').trim());
}

/**
 * 张数 → 收敛到参考站的 6–10。
 *
 * 服务端也要收敛: 前端步进器是软约束, 直接调接口能传 999 张
 * (每张一份账单), 不收敛就是资损入口。
 */
export function shoppableCarouselCount(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return SHOPPABLE_CAROUSEL_MIN_COUNT;
  return Math.min(SHOPPABLE_CAROUSEL_MAX_COUNT, Math.max(SHOPPABLE_CAROUSEL_MIN_COUNT, n));
}

/**
 * 第 k 张（1 基）用的拍序号（1–3）。
 *
 * 按拍循环是参考站的口径: 6 张 = 三拍各出 2 遍。
 */
export function shoppableCarouselBeatIndex(index1: number): number {
  return ((index1 - 1) % 3) + 1;
}

export const ShoppableCarousel: CapabilityPlugin = {
  id: 'shoppable_carousel',
  name: 'AI 带货图文',
  group: 'ecommerce_gen',
  summary: '选模板、写卖点，批量出社媒图文套图。',
  sidebarHint: '上传商品图、选模板，一次出成套带货图文',
  mode: 'real',
  creditCost: 10, // 单张图文价；一次生成按张数各扣一份（见 outputPlan）
  params: [
    /*
     * 模板 id 声明为 text 而非 enum: 模板库有 49 项, 把它们塞进
     * `GET /capabilities` 的 options 会让能力清单接口膨胀 49 倍。
     * 合法性由 `validateCapabilityParams` 的跨字段校验兜住
     * (mode=template 时模板 id 必须真实存在), 不靠枚举回落。
     */
    { key: 'templateId', label: '模板', type: 'text', hidden: true, maxLength: 64 },
    { key: 'sellingPoints', label: '商品卖点与生成要求', type: 'text', maxLength: 2000 },
    { key: 'platform', label: '投放平台', type: 'enum', default: 'douyin', options: SOCIAL_PLATFORMS },
    { key: 'market', label: '目标市场', type: 'enum', default: 'cn', options: TARGET_MARKETS },
    { key: 'language', label: '输出语言', type: 'enum', default: 'zh', options: OUTPUT_LANGUAGES },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '3:4', options: CAROUSEL_RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    { key: 'count', label: '生成张数', type: 'number', default: SHOPPABLE_CAROUSEL_MIN_COUNT, min: SHOPPABLE_CAROUSEL_MIN_COUNT, max: SHOPPABLE_CAROUSEL_MAX_COUNT, step: 1 },
    { key: 'mode', label: '生成模式', type: 'enum', default: 'ai', options: [
      { value: 'ai', label: 'AI 智能生成' },
      { value: 'template', label: '模板生成' },
    ] },
    { key: 'noText', label: '图片不加文字', type: 'boolean', default: false },
    { key: 'socialCaption', label: '生成社媒帖子发布文案', type: 'boolean', default: true },
    // ── 批次技术字段（页面按一次提交代填, 结果栏据此把多张图聚合成一行） ──
    /*
     * 模板名必须声明为 hidden 参数才会被 `sanitizeParams` 保留：
     * 未声明的 key 会被静默丢弃，历史记录就只剩 templateId，
     * 卡片只能回落成「AI 智能生成」，把模板批次误标成 AI 生成。
     * 值由服务端在 `outputPlan` 里按 templateId 回填，不信任客户端传值。
     */
    { key: 'templateName', label: '模板名称', type: 'text', hidden: true, maxLength: 64 },
    { key: 'beatIndex', label: '拍序号', type: 'number', hidden: true, min: 1, max: 3, step: 1 },
    { key: 'beatLabel', label: '拍名称', type: 'text', hidden: true },
    { key: 'shotIndex', label: '本批张序', type: 'number', hidden: true, min: 1, max: 10, step: 1 },
    { key: 'batchId', label: '批次 ID', type: 'text', hidden: true, maxLength: 128 },
    { key: 'batchIndex', label: '批次序号', type: 'number', hidden: true, min: 1, max: 10, step: 1 },
    { key: 'batchSize', label: '批次数量', type: 'number', hidden: true, min: 1, max: 10, step: 1 },
  ],
  buildPrompt: (p) => {
    const template = shoppableCarouselTemplate(p.templateId);
    const beat = Number(p.beatIndex) || 1;
    const beatLabel = String(p.beatLabel ?? '').trim() || template?.beats[beat - 1] || '';
    const mode = p.mode === 'template' ? 'template' : 'ai';
    const platform = labelOf(SOCIAL_PLATFORMS, p.platform);
    const market = labelOf(TARGET_MARKETS, p.market);
    const language = labelOf(OUTPUT_LANGUAGES, p.language);
    const count = shoppableCarouselCount(p.count);

    const parts: string[] = [];
    parts.push(
      `电商带货图文生成：${p.sellingPoints ? String(p.sellingPoints).trim() : '突出商品核心卖点与使用场景'}。`,
    );
    if (mode === 'template' && template) {
      const cats = template.categoryIds.map((c) => CATEGORY_LABEL.get(c)).filter(Boolean).join('、');
      parts.push(
        `采用「${template.name}」模板的三拍叙事结构，本张为第 ${beat} 拍（${beatLabel}）` +
          `${count > 3 ? `，同模板共出 ${count} 张、按三拍循环出图，本张需与同批其它张在同一商品与场景基调下呈现不同层次` : ''}。` +
          (cats ? `商品品类定位：${cats}。` : '') +
          template.promptFragment,
      );
    } else {
      parts.push(
        `AI 智能生成版式：按社媒带货图文惯例自动设计图文内容与排版，本张为第 ${beat} 段（${beatLabel || '产品展示'}）` +
          `${count > 1 ? `，同批共 ${count} 张，需与同批其它张在主体一致的前提下呈现不同内容角度` : ''}。`,
      );
    }
    parts.push(
      `主体在整组画面中保持一致（同一商品、包装、颜色与材质），适配${platform}，面向${market}市场，` +
        `画面内文字使用${language}。`,
    );
    const noText = p.noText === true || p.noText === 'true' || p.noText === 1 || p.noText === '1';
    const withCaption =
      p.socialCaption === true || p.socialCaption === 'true' || p.socialCaption === 1 || p.socialCaption === '1';
    if (noText) {
      // 开关优先级: 「图片不加文字」压过「社媒帖子发布文案」—— 两者语义互斥,
      // 用户显式要求不加字时, 不能再往画面里塞发布文案。
      parts.push('本张不添加任何文字，画面突出产品使用场景');
    } else {
      parts.push('画面可包含简短卖点文案，文案不超过 12 字，不出现品牌 logo、价格标签与平台水印');
      if (withCaption) {
        /*
         * 「社媒帖子发布文案」(参考站附加功能, 默认开)。
         *
         * 本能力是**单张图片**产出 (modality=image), 不能返回独立的一段文字,
         * 故把发布文案落进画面: 由模型在版式里留出一条可直接复制发布的短文案。
         * 这样开关是真实生效的, 而不是一个点了没反应的死开关。
         */
        parts.push(
          `；并在画面版式中安排一条可直接用于社媒发布的帖子文案（一句话，含商品核心卖点，使用${language}）`,
        );
      }
    }
    parts.push(`${ratioText(p.ratio)}${sizeText(p.size)}`);
    return parts.join('');
  },
  /*
   * 一次提交出 N 张图文（N = 张数, 6–10）; 每张各扣一次 creditCost。
   *
   * 与 `DetailImage` 的 outputPlan 同一套机制 —— 准入层拆任务、各自计费、
   * 共享 batchId 供前端聚合成「一次生成」。此处只负责「拆成哪几张、每张叫什么」。
   */
  outputPlan: (p) => {
    const count = shoppableCarouselCount(p.count);
    const template = shoppableCarouselTemplate(p.templateId);
    const mode = p.mode === 'template' ? 'template' : 'ai';
    return Array.from({ length: count }, (_, i) => {
      const shot = i + 1;
      const beat = shoppableCarouselBeatIndex(shot);
      const beatLabel = template?.beats[beat - 1] ?? '';
      return {
        key: `shot-${shot}`,
        label: beatLabel ? `第 ${shot} 张 · ${beatLabel}` : `第 ${shot} 张`,
        params: {
          beatIndex: beat,
          beatLabel,
          shotIndex: shot,
          // 展示名以服务端模板表为准, 覆盖客户端传入值
          templateName: mode === 'template' ? (template?.name ?? '') : '',
          // mode=template 但没选模板时, 退回 AI 智能生成 —— 不能让模型收到空模板
          ...(mode === 'template' && template ? {} : { mode: 'ai' }),
        },
      };
    });
  },
  modality: 'image',
  model: { capability: 'image', operation: 'text_to_image', intent: generateImageIntent },
  inputs: 1,
  /** 参考站实拍「同一产品，最多 5 张」—— 服务端同样拒绝超额提交 */
  maxInputs: 5,
  inWorkbench: true,
};
