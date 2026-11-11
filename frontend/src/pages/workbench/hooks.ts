/**
 * 工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页没有独有 hook; 以后出现「只服务本页」的取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `workbench/` 下的文件不从 `src/context` 直接取 hook,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 登录态: token 决定是否拉统计, openLogin 唤起登录弹窗 */
export { useAuth } from '../../context/AuthContext';
/** 积分余额（账号面板首格） */
export { useCredits } from '../../context/CreditsContext';
