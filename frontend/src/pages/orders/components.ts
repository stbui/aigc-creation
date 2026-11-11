/**
 * 我的订单页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `orders/` 下的文件不从 `src/components` / `src/ui` 直接取东西,
 * 一律经由本文件 —— 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (lucide-react / react-router-dom) 不经本文件 ——
 * 它们不是本项目的共享控件。
 */

/** 个人中心外壳 (标题 / 描述 / 右侧动作) */
export { PersonalPage } from '../../components/PersonalPage';
/** 按钮型 / 空态 / 错误态 / 骨架屏 */
export { StateButton, StateEmpty, StateError, StateSkeleton } from '../../components/StateViews';
/** C 端 UI 控件 */
export { Button, Input, Select } from '../../ui';
