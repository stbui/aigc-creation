/**
 * 积分明细页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `credits/` 下的文件不从 `src/components` / `src/ui` 直接取东西,
 * 一律经由本文件。第三方 UI 库 (lucide-react) 不经本文件。
 */

/** 个人中心外壳 */
export { PersonalPage } from '../../components/PersonalPage';
/** 空态 / 失败态 / 骨架屏与空态按钮 */
export { StateButton, StateEmpty, StateError, StateSkeleton } from '../../components/StateViews';

/** shadcn / 兼容层组合件 */
export { Button, Card, Col, Pagination, Row, Select, Table, Tabs, Tag } from '../../ui';
