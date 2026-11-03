/**
 * 邀请有奖页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 约定: `invitations/` 下的文件不从 `src/hooks` / `src/context` / `src/ui` 直接取 hook,
 * 一律经由本文件。
 */

/** 登录态: 访客只渲染登录引导, 不请求需要鉴权的邀请接口 */
export { useAuth } from '../../context/AuthContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 签到成功后广播余额变化, 让顶栏立即刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 全局反馈 (message) */
export { useApp } from '../../ui';
