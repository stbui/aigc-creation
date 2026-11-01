/**
 * 多图融合页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 约定: `multi-image-fusion/` 下的文件不从 `src/hooks` / `src/context` /
 * `src/components` 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时
 * 在这里补一行 re-export。
 */

/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 轮询中止信号 (离开页面 / 重新提交时停掉旧轮询) */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 能力基础价 (再按变体张数与画质倍率换算) */
export { useCreditCost } from '../../hooks/useCreditLabel';
/** 能力运行时状态: 无可用通道时在提交前拦住 */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
/** 页面粘贴上传 */
export { usePasteUpload } from '../../hooks/usePasteUpload';
/** 登录态: 素材库 / 手机上传 / 提交前判断 */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 素材库取数 (定义在 AssetLibraryModal 文件里) */
export { useAssetLibrary } from '../../components/AssetLibraryModal';
