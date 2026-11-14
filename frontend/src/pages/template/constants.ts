/**
 * 写真模板页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定：`template/` 下的文件不从 `src/lib/constants` 直接取东西，
 * 一律经由本文件 —— 上传上限与默认值集中可见，调整只改一处。
 */

/** 单张图片体积上限 (MB)，全站上传校验共用 */
export { MAX_IMAGE_MB } from '../../lib/constants';

/** 一次最多上传的人像参考照片数（与后端 `maxInputs` 一致）。 */
export const MAX_IMAGES = 5;

/** 能力 id（建任务与取价都用它） */
export const CAPABILITY_ID = 'template';

/** 默认画面比例（竖版 9:16，适配手机端写真）；比例选项由高级设置浮层统一提供。 */
export const DEFAULT_RATIO = '9:16';

/** 默认画质档位（与全站生图能力一致）。 */
export const DEFAULT_SIZE = '2k';

/** 分类 tab 的「全部」项（纯前端筛选态，不来自后端） */
export const ALL_CATEGORY = '';
/** 二级分类的「全部分组」项 */
export const ALL_GROUP = '';
