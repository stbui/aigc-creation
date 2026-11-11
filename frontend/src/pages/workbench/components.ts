/**
 * 工作台页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `workbench/` 下的文件不从 `src/components` / `src/layout` 直接取东西,
 * 一律经由本文件 —— 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (lucide-react / react-router-dom) 不经本文件 ——
 * 它们不是本项目的共享控件。
 */

/** 能力图标（侧栏 / 卡片共用） */
export { CapabilityIcon } from '../../layout';
/** 错误态 / 骨架屏 */
export { StateError, StateSkeleton } from '../../components/StateViews';
