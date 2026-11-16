/**
 * 账单目录对外共享的展示常量出口。
 *
 * `index.ts` 是路由懒加载目标，其具名导出被 `lazyAdminPage` 约束为「全是 React
 * 组件」，因此不能在其中 re-export 常量对象。兄弟模块（如任务账单页）要复用
 * 账单状态文案时，统一从本文件取，避免直接穿透到 `constants.ts` 叶子文件。
 */
export { REFUND_REASON_LABELS, STATUS_LABELS, STATUS_TONES } from './constants';
