/**
 * 商品 SKU 图工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页没有独有 hook; 以后出现「只服务本页」的取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `product-sku/` 下的文件不从 `src/hooks` / `src/context` / `src/components`
 * 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 轮询中止信号 (离开页面 / 重新提交时停掉旧轮询) */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 模板图粘贴上传 */
export { usePasteUpload } from '../../hooks/usePasteUpload';
/** 结果列表轮询; `GalleryItem` 是历史面板的数据类型 */
export { useResultGallery, type GalleryItem } from '../../hooks/useResultGallery';
/** 登录态: 判断是否已登录 */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 素材库取数 (定义在 AssetLibraryModal 文件里) */
export { useAssetLibrary } from '../../components/AssetLibraryModal';
