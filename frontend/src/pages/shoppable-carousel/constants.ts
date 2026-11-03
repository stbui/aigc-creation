/**
 * AI 带货图文页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定: `shoppable-carousel/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 —— 页面上传上限、字段长度与生成张数区间集中可见, 调整只改一处。
 */

/** 单张图片体积上限 (MB), 全站上传校验共用 */
export { MAX_IMAGE_MB } from '../../lib/constants';

/**
 * 一次最多上传的商品图张数 (参考站实拍: 「同一产品，最多5张。」)
 */
export const MAX_IMAGES = 5;

/**
 * 卖点文案最大长度 (参考站实测未设 maxLength, 本站显式收敛到 2000 —— 与
 * 后端 `sellingPoints` 参数的 `maxLength` 一致, 超长在提交前就拦下)
 */
export const MAX_SELLING_POINTS_LEN = 2000;

/**
 * 生成张数区间 (参考站步进器实测: 6–10, 减号在 6 时禁用、加号在 10 时禁用)
 *
 * 与后端 `definitions/shoppable_carousel.ts` 的
 * `SHOPPABLE_CAROUSEL_MIN_COUNT` / `SHOPPABLE_CAROUSEL_MAX_COUNT` 同值 ——
 * 服务端同样收敛, 直接调接口绕过步进器也拿不到越界张数。
 */
export const MIN_COUNT = 6;
export const MAX_COUNT = 10;

/** 默认张数 (参考站初值) */
export const DEFAULT_COUNT = 6;

/**
 * 生成设置的四组下拉选项 (参考站实拍全量)
 *
 * 与 `param-options.ts` 的 `PLATFORMS`(9 项电商上架平台) / `LANGUAGES`(10 项)
 * **不是同一组** —— 参考站带货图文页的「平台」指社媒发布去向, 不是上架平台。
 * 详见 `docs/shoppable-carousel-design.md` §3.2。
 */
export const PLATFORM_OPTIONS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'instagram', label: 'Instagram' },
];

export const MARKET_OPTIONS = [
  { value: 'us', label: '美国' },
  { value: 'eu', label: '欧洲' },
  { value: 'cn', label: '中国' },
  { value: 'ru', label: '俄罗斯' },
  { value: 'sea', label: '东南亚' },
  { value: 'es', label: '西班牙' },
  { value: 'de', label: '德国' },
  { value: 'jp', label: '日本' },
];

export const LANGUAGE_OPTIONS = [
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
 * 生成设置的默认值：抖音 / 中国 / 中文。
 *
 * 参考站实拍初值是 TikTok / 美国 / 英文；本站面向国内电商团队，
 * 默认改成这三个（产品决定，属主动偏离）。选项清单与顺序仍与参考站一致，
 * 只换初值。与后端 `definitions/shoppable_carousel.ts` 的 `default` 同值，
 * 后端在参数缺省时会用同一组默认值补全。
 */
export const DEFAULT_PLATFORM = 'douyin';
export const DEFAULT_MARKET = 'cn';
export const DEFAULT_LANGUAGE = 'zh';

/** 画面比例 (参考站实拍 4 项, 默认 3:4) */
export const RATIO_OPTIONS = [
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '9:16', label: '9:16' },
  { value: '3:4', label: '3:4' },
];

/** 画质档位 (与全站生图能力一致) */
export const QUALITY_OPTIONS = [
  { value: '1k', label: '1K (1024px)' },
  { value: '2k', label: '2K (2048px)' },
  { value: '4k', label: '4K (4096px)' },
];

/** 能力 id (建任务与取价都用它) */
export const CAPABILITY_ID = 'shoppable_carousel';

/**
 * 卖点文案输入框的 placeholder (参考站实拍原文)
 */
export const SELLING_POINTS_PLACEHOLDER =
  '建议包含以下信息生成更精准：\n1.产品名称\n2.核心卖点\n3.适用人群\n4.期望场景\n5.具体参数';
