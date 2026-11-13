/**
 * 多图融合页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 页面级状态按职责拆成三个目录内 hook（实现见同目录 `useMultiFusion*.ts`，
 * 由本文件转出）：
 * - `useMultiFusionAssets`  —— 主体图 / 搭配图的上传、素材库与手机回填
 * - `useMultiFusionPrompt`  —— 画面描述与 AI 分析
 * - `useMultiFusionTask`    —— 提交、轮询、结果与超时重查
 *
 * 约定: `multi-image-fusion/` 下的文件不从 `src/hooks` / `src/context` /
 * `src/components` 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时
 * 在这里补一行 re-export。
 */

export { useMultiFusionAssets } from './useMultiFusionAssets';
export {
  useMultiFusionTask,
  type MultiFusionFailure,
} from './useMultiFusionTask';
export {
  useMultiFusionPrompt,
  type MultiFusionAnalysisMessage,
} from './useMultiFusionPrompt';

/** 能力基础价 (再按变体张数与画质倍率换算) */
export { useCreditCost } from '../../hooks/useCreditLabel';
/** 能力运行时状态: 无可用通道时在提交前拦住 */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
/** 登录态: 能力不可用的拦截只对已登录用户生效 */
export { useAuth } from '../../context/AuthContext';
