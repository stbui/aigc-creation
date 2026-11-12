/**
 * 素材库页面的常量与共享类型 —— 目录内文件的唯一常量入口。
 *
 * 约定: `library/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 —— 分页节奏、筛选档位与分组结构集中可见, 调整只改一处。
 */

/** 单张图片体积上限与格式白名单, 与全站上传校验共用 */
export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
} from '../../lib/constants';

/** 首屏与滚动加载每次追加的素材数（默认一次加载 50 张，向下滚动自动续加） */
export const PAGE_SIZE = 50;

/** 素材来源筛选: 全部 / 本地上传 / 生成图 */
export type AssetKind = 'all' | 'original' | 'generated';

/** 默认来源：素材库主路径是管理本地上传的原图，生成结果由用户主动切换查看 */
export const DEFAULT_ASSET_KIND: AssetKind = 'original';

/** 分组依据。'none' = 不分组，只在面板上给切换入口 */
export type GroupBy = 'none' | 'project' | 'capability' | 'date';

/** 一个分组在面板上的展示数据 */
export interface AssetGroup {
  key: string;
  label: string;
  count: number;
  sort: number;
}

/** 来源筛选下拉项 */
export const ASSET_KIND_OPTIONS: Array<{ value: AssetKind; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'original', label: '本地上传' },
  { value: 'generated', label: '生成图' },
];
