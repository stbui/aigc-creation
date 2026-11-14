/**
 * 自由创作工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页没有独有 hook; 上传 / 结果轮询 / 价签 / 幂等键 / 删除等通用逻辑
 * 从 `src/hooks` 转出。
 *
 * 约定: `creative-image/` 下的文件不从 `src/hooks` / `src/context` / `src/components`
 * 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 上传 (三重校验 / 素材库回填 / 粘贴 / 排序) */
export { useImageUpload, type UploadedImage } from '../../hooks/useImageUpload';
/** 模型实时报价优先的价签 */
export { useModelQuoteCreditLabel } from '../../hooks/useModelQuoteCreditLabel';
/** 单次提交的幂等键 */
export { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
/** 删除单张作品（确认框 + 接口 + 本地摘除） */
export { useDeleteGalleryItem } from '../../hooks/useDeleteGalleryItem';
/** 结果列表轮询; `GalleryItem` 是结果网格的数据类型 */
export {
  hasActiveGalleryItems,
  useResultGallery,
  type GalleryItem,
} from '../../hooks/useResultGallery';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 轮询中止信号 (离开页面 / 重新提交时停掉旧轮询) */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 能力运行时状态: 后台下线或无线路时在前端事前标注 */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
