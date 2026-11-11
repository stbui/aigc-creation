/**
 * 我的订单页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页没有独有 hook; 以后出现「只服务本页」的取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `orders/` 下的文件不从 `src/hooks` / `src/context` / `src/ui` 直接取 hook,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 登录态: token 决定是否拉订单, openLogin 唤起登录弹窗 */
export { useAuth } from '../../context/AuthContext';
/** 路由级标题 / 描述 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 全局提示与确认弹窗（取消订单走二次确认） */
export { useApp } from '../../ui';
