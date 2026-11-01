/**
 * 一键抠图页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 约定: `background-remove/` 下的文件不从 `src/hooks` / `src/context` 直接取 hook,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 任务提交 / 结果状态 (能力固定为 matting) */
export { useToolTask } from '../../hooks/useToolTask';
/** 能力定价: 0 元档展示「限时免费」 */
export { useCreditCost } from '../../hooks/useCreditLabel';
