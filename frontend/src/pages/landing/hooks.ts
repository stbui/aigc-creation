/**
 * 营销首页的 hooks 入口 —— 目录内文件的唯一 hooks 来源。
 *
 * 约定: `landing/` 下的文件不从 `src/hooks` / `src/context` 直接取 hook,
 * 一律经由本文件。
 */

/** 能力清单 (导航分组、入口可见性、CTA 判定) */
export { useCapabilities } from '../../hooks/useCapabilities';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 登录态 (顶导「进入工作台 / 登录注册」) */
export { useAuth } from '../../context/AuthContext';
