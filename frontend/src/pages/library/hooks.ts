/**
 * 素材库页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 约定: `library/` 下的文件不从 `src/hooks` / `src/context` / `src/ui` 直接取 hook,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 登录态: 访客不请求素材接口, 空态改为「登录后管理素材」 */
export { useAuth } from '../../context/AuthContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 大图查看器下标（越界收敛 + id→下标映射） */
export { useLightboxIndex } from '../../hooks/useLightboxIndex';
/** 上传前确保项目存在 */
export { useProject } from '../../hooks/useProject';
/** 能力清单: 能力筛选下拉的真实数据源 */
export { useCapabilities } from '../../hooks/useCapabilities';
/** 全局反馈 (message) */
export { useApp } from '../../ui';
