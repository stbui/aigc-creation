import type { TaskStatus } from '../../types/api';

/**
 * 爆款复刻工作台页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定: `viral-clone/` 下的文件不从 `src/lib/constants` 直接取东西, 一律经由本文件 ——
 * 页面用到的上传上限、字段长度与复刻程度清单集中可见, 调整只改一处。
 * 目录内新增共享常量时在这里补一行 re-export。
 */

/** 单张图片体积上限 (字节 / MB) 与支持格式说明, 全站上传校验共用 */
export { MAX_IMAGE_BYTES, MAX_IMAGE_MB, SUPPORTED_IMAGE_LABEL } from '../../lib/constants';

// ───────────────── 上传与字段长度 (参考站实拍) ─────────────────

/** 一次提交最多上传的商品图张数 */
export const MAX_IMAGES = 5;
/** 商品名称 / 品牌输入上限 */
export const MAX_NAME_LEN = 100;
/** 复刻要求 textarea 上限 */
export const MAX_REQUIREMENT_LEN = 1000;
/** 复刻要求输入提示：只给可控的画面偏好，不示例复刻真实人物身份。 */
export const REQUIREMENT_PLACEHOLDER = '例如：背景保持简洁、商品居中、文案使用英文。';

// ───────────────── 复刻程度 ─────────────────

/** 复刻程度两档 (实拍: 默认选中「高度复刻」) */
export const CLONE_DEGREES: Array<{
  value: 'reference_style' | 'high_replica';
  label: string;
  desc: string;
}> = [
  { value: 'reference_style', label: '参考风格', desc: '提取参考图构图、配色与光影，允许调整背景和道具。' },
  { value: 'high_replica', label: '高度复刻', desc: '锁定参考图构图与场景，替换为你的商品并保证商品不变形。' },
];

/** 复刻程度键 → 中文标签 (结果网格 caption 用) */
export const DEGREE_LABEL: Record<string, string> = {
  reference_style: '参考风格',
  high_replica: '高度复刻',
};

/** 本页上传区里的素材 (商品图 / 参考图共用) */
export interface PkAsset {
  id: string;
  url: string;
  name: string;
}

/** 一次爆款复刻任务的结果 (只用于本次提交的提示行) */
export interface PkResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}
