/**
 * 营销首页的外部控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `landing/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件。
 * 目录内新增共享控件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (lucide-react) 不经本文件 —— 它们不是本项目的共享控件。
 */

/** 顶部促销条 (限时活动横幅) */
export { PromoBar } from '../../components/PromoBar';
