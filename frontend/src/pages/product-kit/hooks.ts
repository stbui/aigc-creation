/**
 * 商品主图工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用上传 / 结果轮询 / 生成设置从 `src/hooks` 转出; 右侧页签的自动落位
 * 与生成设置已上收为共享 hook，本文件只做转出。
 *
 * 约定: `product-kit/` 下的文件不从 `src/hooks` / `src/context` 直接取东西,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 上传 (三重校验 / 素材库回填 / 粘贴 / 排序) */
export { useImageUpload, type UploadedImage } from '../../hooks/useImageUpload';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 实时积分单价 (后台可调价) */
export { useCreditLabel, useCreditCost } from '../../hooks/useCreditLabel';
/** 模型实时报价优先的价签 */
export { useModelQuoteCreditLabel } from '../../hooks/useModelQuoteCreditLabel';
/** 平台 / 比例 / 画质的生成设置 */
export { useGenerationSettings } from '../../hooks/useGenerationSettings';
/** AI 分析：首张商品图 → 商品描述 */
export { useImageToPromptAnalysis } from '../../hooks/useImageToPromptAnalysis';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果网格的数据类型 */
export {
  hasActiveGalleryItems,
  useResultGallery,
  type GalleryItem,
} from '../../hooks/useResultGallery';
export { useRightTab, type RightTab } from '../../hooks/useRightTab';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
