/**
 * 局部重绘页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 约定: `local-redraw/` 下的文件不从 `src/hooks` / `src/context` 直接取东西,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 任务提交 / 结果状态 (能力固定为 local_redraw) */
export { useToolTask } from '../../hooks/useToolTask';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 登录态: 历史记录读取与提交前判断 */
export { useAuth } from '../../context/AuthContext';
