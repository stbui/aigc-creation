import type { ParamOption } from '../capability-plugin.type';

/**
 * 跨能力复用的参数选项集 (2026-10-20 抽离)。
 *
 * 为什么独立成文件而不是每个能力文件各写一份: 平台/语言/比例这几组选项
 * 被 5~6 项能力共用 (主图、详情图、爆款复刻都带「平台 + 语言」),
 * 各写一份必然漂移 —— 参考站的平台清单是 9 项, 少一项就会让某个页面的
 * 下拉与参考站对不上, 而这种差异极难在 review 时看出来。
 *
 * 取值来源均为参考站实拍 (见各常量注释), 与上游一一对应, 不得擅自增删。
 */

/** 平台清单与参考站 product-kit 一致 (9 项, value 与参考站 data 属性相同) */
export const PLATFORMS: ParamOption[] = [
  { value: 'taobao', label: '淘宝' },
  { value: 'jd', label: '京东' },
  { value: 'douyin', label: '抖音' },
  { value: 'pdd', label: '拼多多' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'tiktok-shop', label: 'TikTok' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'temu', label: 'Temu' },
];

/**
 * 输出语言 (参考站「语言」下拉 10 项)
 *
 * 本地算法图内文字仅 ASCII, 该参数记录于任务参数并在结果卡片展示,
 * 不参与像素渲染; 接云端模型后它才真正参与提示词。
 */
export const LANGUAGES: ParamOption[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'es-ES', label: 'Español' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'pt-PT', label: 'Português' },
  { value: 'id-ID', label: 'Bahasa Indonesia' },
  { value: 'th-TH', label: 'ไทย' },
];

/** 画面比例 (参考站高级设置 8 项) */
export const RATIOS: ParamOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '21:9', label: '21:9' },
];

/**
 * 修图系工具的比例选项: 参考站这些页面高级设置默认「原比例」(保持输入图尺寸),
 * 复刻时把「原比例」作为首项与默认值, 其余 8 项与生图工具一致。
 */
export const RATIOS_WITH_ORIGINAL: ParamOption[] = [{ value: 'original', label: '原比例' }, ...RATIOS];

/** 抠图/换色的背景色板 (参考站 background-color-options 实拍: 色值与 aria-label 一致) */
export const BG_COLOR_OPTIONS: ParamOption[] = [
  { value: 'transparent', label: '透明底' },
  { value: '#FFFFFF', label: '白色' },
  { value: '#82CEF3', label: '浅蓝' },
  { value: '#3988E9', label: '蓝色' },
  { value: '#FF0B22', label: '红色' },
  { value: '#A8001B', label: '深红' },
  { value: 'custom', label: '自定义颜色' },
];

/** 智能扩图「原图位置」九宫格 (参考站 smart-expand-position-grid 实拍, 默认 center) */
export const EXPAND_POSITIONS: ParamOption[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top', label: '上' },
  { value: 'top-right', label: '右上' },
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom', label: '下' },
  { value: 'bottom-right', label: '右下' },
];

/** 产品精修 6 种模式 (参考站 retouch-mode-options 实拍, 默认综合精修) */
export const RETOUCH_MODES: ParamOption[] = [
  { value: 'comprehensive', label: '综合精修' },
  { value: 'texture', label: '质感增强' },
  { value: 'blemish', label: '瑕疵修复' },
  { value: 'color', label: '色彩校正' },
  { value: 'clarity', label: '提升清晰度' },
  { value: 'material', label: '材质强化' },
];

/** 多图融合 15 个场景 (参考站场景网关实拍: 表面附着 7 + 空间摆放 8, 默认第一个) */
export const FUSION_SCENARIOS: ParamOption[] = [
  { value: 'print_pattern', label: '印花/图案' },
  { value: 'embroidery', label: '刺绣/绣花' },
  { value: 'texture', label: '纹理/材质' },
  { value: 'sticker', label: '贴纸/贴花' },
  { value: 'hot_stamping', label: '烫金/烫印' },
  { value: 'carving', label: '雕刻/蚀刻' },
  { value: 'painting', label: '彩绘/涂装' },
  { value: 'table_display', label: '桌面陈列' },
  { value: 'wearing', label: '穿搭/佩戴' },
  { value: 'scene_match', label: '场景搭配' },
  { value: 'handheld', label: '手持展示' },
  { value: 'combo_set', label: '组合套装' },
  { value: 'food_plating', label: '食品摆盘' },
  { value: 'storage_display', label: '收纳展示' },
  { value: 'shelf_display', label: '货架陈列' },
];

/** 多图融合「变体张数」 (参考站输出参数按钮 4/3/2/1, 默认 4) */
export const FUSION_VARIANT_COUNTS: ParamOption[] = [
  { value: '4', label: '4 张' },
  { value: '3', label: '3 张' },
  { value: '2', label: '2 张' },
  { value: '1', label: '1 张' },
];

/** 主图变体: 对应参考站「自定义配置」的四类计数, 每类一次生成一张 */
export const MAIN_IMAGE_VARIANTS: ParamOption[] = [
  { value: 'white_background', label: '白底图' },
  { value: 'scene', label: '场景图' },
  { value: 'selling_point', label: '卖点图' },
  { value: 'other', label: '其他图' },
];

/**
 * 详情页模块 (参考站 product-detail「包含模块」多选 16 项, 默认勾选前 6 项, 上限 10)。
 * value 为英文键: 界面显示中文标签, 参数与图内文字用键名 (Jimp 字体仅 ASCII)。
 */
export const DETAIL_SECTIONS: ParamOption[] = [
  { value: 'hero', label: '首屏主视觉' },
  { value: 'selling_points', label: '核心卖点图' },
  { value: 'usage_scene', label: '使用场景图' },
  { value: 'multi_angle', label: '多角度图' },
  { value: 'scene_atmosphere', label: '场景氛围图' },
  { value: 'product_detail', label: '商品细节图' },
  { value: 'brand_story', label: '品牌故事图' },
  { value: 'size_spec', label: '尺寸/容量/尺码图' },
  { value: 'effect_compare', label: '效果对比图' },
  { value: 'spec_table', label: '详细规格/参数表' },
  { value: 'craft_process', label: '工艺制作图' },
  { value: 'accessories', label: '配件/随箱物品图' },
  { value: 'series_display', label: '系列展示图' },
  { value: 'ingredients', label: '商品成分图' },
  { value: 'after_sale', label: '售后保障图' },
  { value: 'usage_tips', label: '使用建议图' },
];

export const DETAIL_SECTION_DEFAULTS: string[] = DETAIL_SECTIONS.slice(0, 6).map((s) => String(s.value));

/**
 * 解析「包含模块」参数: 逗号分隔字符串 → 合法键数组。
 * 保序去重、过滤未知键、上限 10 (与参考站「已选 N/10」一致), 空值回落默认 6 项。
 */
export function parseDetailSections(raw: unknown): string[] {
  const valid = new Set(DETAIL_SECTIONS.map((s) => String(s.value)));
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => valid.has(s));
  const out = [...new Set(list)];
  return out.length > 0 ? out.slice(0, 10) : [...DETAIL_SECTION_DEFAULTS];
}

/**
 * 画质枚举 (参考站高级设置 1K/2K/4K)。
 *
 * 2026-10-22 起 4K 由后端声明 —— 原先只声明 1K/2K, 前端再按运行时补一档,
 * 结果是「后端不认的档位靠前端兜」: 直接调接口传 `size=4k` 会被 sanitizeParams
 * 静默回落成默认值, 而界面上那一档看起来是可用的。
 *
 * 三档的实际兑现能力不同, 且**这一点不能靠隐藏档位来表达**:
 *   - 1K / 2K: 本地 Jimp 算法与云端通道都能兑现
 *   - 4K: 只有云端通道能兑现; 本地回落时硬上限 2048px, 由
 *     `local-image.provider.ts` 打 WARN 说明实际边长, 不谎报 4096
 * 前端据 `runtime.remoteAvailable` 决定 4K 可否选中 (见 `lib/optionSets.ts`)。
 */
export const QUALITY_OPTIONS: ParamOption[] = [
  { value: '1k', label: '1K (1024px)' },
  { value: '2k', label: '2K (2048px)' },
  { value: '4k', label: '4K (4096px)' },
];

// ───────────────── 提示词公用片段 ─────────────────

/**
 * 提示词公用片段构造器。
 *
 * 抽出来是因为比例/规格/商品主体这三段在 15 项能力的提示词里重复出现十几次,
 * 写法必须完全一致 —— 否则同一句式在主图里是「画面比例 1:1」、在详情图里
 * 变成「比例 1:1」, 模型对两种表述的响应权重不同, 复刻的 1:1 行为会漂。
 */
export const ratioText = (r?: string): string => (r ? `，画面比例 ${r}` : '');
export const sizeText = (s?: string): string => (s ? `，输出规格 ${String(s).toUpperCase()}` : '');

export const subjectText = (p: Record<string, any>): string => {
  const name = p.productName ? `商品「${p.productName}」` : '商品主体';
  const brand = p.brand ? `（品牌 ${p.brand}）` : '';
  return `${name}${brand}`;
};

/**
 * 参考图张数的自然表述。
 *
 * ⚠️ refCount 现在是**显式入参** (PromptBuilder 的第二个参数),
 * 不再靠往 params 里塞 `__refCount` 隐式传递 —— 后者会让业务参数
 * 与内部标记混在一起, 落库后难以区分哪个是用户填的。
 */
export function refCountText(refCount: number): string {
  return refCount > 0 ? `，并参考上传的 ${refCount} 张参考图` : '';
}