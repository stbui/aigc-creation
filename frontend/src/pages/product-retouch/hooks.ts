/**
 * 产品精修页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页没有独有 hook; 以后出现「只服务本页」的取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `product-retouch/` 下的文件不从 `src/hooks` / `src/context` 直接取 hook,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 任务提交 / 结果状态 (能力固定为 enhance) */
export { useToolTask } from '../../hooks/useToolTask';
