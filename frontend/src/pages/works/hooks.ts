/**
 * 我的作品页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 约定: `works/` 下的文件不从 `src/hooks` / `src/context` / `src/ui` 直接取 hook,
 * 一律经由本文件。
 */

/** 能力清单: 业务类型筛选与重试前的运行时判断 */
export { useCapabilities } from '../../hooks/useCapabilities';
/** 页面卸载时中止进行中的重试轮询 */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 接口错误码 → 用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 登录态 */
export { useAuth } from '../../context/AuthContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 大图查看器下标（越界收敛 + id→下标映射） */
export { useLightboxIndex } from '../../hooks/useLightboxIndex';
/** 删除 / 重试后广播余额变化 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 全局反馈 (message / modal) */
export { useApp } from '../../ui';
