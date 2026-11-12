/**
 * 数据中心页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `stats/` 下的文件不从 `src/components` / `src/ui` 直接取东西,
 * 一律经由本文件。第三方 UI 库 (lucide-react) 不经本文件。
 */

/** 个人中心外壳 */
export { PersonalPage } from '../../components/PersonalPage';
/** 空态 / 失败态 / 骨架屏 */
export { StateEmpty, StateError, StateSkeleton } from '../../components/StateViews';
/** shadcn 按钮 */
export { Button } from '../../ui';
