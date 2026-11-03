/**
 * 邀请有奖页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `invitations/` 下的文件不从 `src/components` / `src/ui` 直接取东西,
 * 一律经由本文件。第三方 UI 库 (lucide-react) 与 qrcode 不经本文件。
 */

/** 个人中心外壳 (标题 / 描述 / 内容区) */
export { PersonalPage } from '../../components/PersonalPage';
/** 空态 / 失败态 / 骨架屏 */
export { StateEmpty, StateError, StateSkeleton } from '../../components/StateViews';

/** shadcn 组合件 */
export { Button, Modal } from '../../ui';
