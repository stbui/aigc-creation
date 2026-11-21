/**
 * 渠道工作台的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定:
 *   - 实现按职责拆在同目录：`headers`（自定义请求头校验）、`modelDraft`
 *     （实体 ⇄ 草稿与价格档）、`modelState`（商品状态）、`selectors`
 *     （规格选择器 / 标签 / 积分）、`metrics`（健康指标展示）；
 *   - 本文件只做转出，函数不依赖 React，可被页面、组件与 hooks 共用；
 *   - 目录内文件不从 `src/lib/<工具>` 直接取东西，一律经由本文件；
 *   - 常量、类型与默认值在 `constants.ts`，外部接口 / 控件 / hook 分别走
 *     `api.ts` / `components.ts` / `hooks.ts`。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/* 外部工具转出：目录内文件不直接引 `src/lib/*`，也不直接引 `~/admin-ui/lib/*` */
export { cn, formatNumber } from '~/admin-ui/radar';
export { formatAmount, formatMarkupPercent, markupPercent, tierPriceLines } from '../../../lib/channelCost';
export { moveOrderItem, orderChanged, type OrderItem } from '../../../lib/channelOrder';
export {
  MAX_REPRICE_MARKUP_PERCENT,
  MAX_REPRICE_MODELS,
  buildRepriceRows,
  computeRepriceSale,
  formatMarkup,
  isValidMarkup,
  parseSaleInput,
  repriceBlockingModels,
  saleInputValue,
  type RepriceRow,
} from '../../../lib/channelReprice';
export { parseCredits, toCredits, toCreditsInput } from '../../../lib/microcredits';
export { downloadJson } from '../../../lib/download';

/* 同目录实现转出 */
export * from './headers';
export * from './metrics';
export * from './modelDraft';
export * from './modelState';
export * from './selectors';
