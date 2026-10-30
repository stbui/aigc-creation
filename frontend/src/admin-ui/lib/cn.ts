/**
 * 类名合并。
 *
 * 直接复用 BoardUI 的 `cx`（内部走 tailwind-merge），保证后台新组件与
 * vendor 源码对同一组 Tailwind 类的覆盖规则一致 —— 自己另写一份会让
 * `p-2 p-4` 这类冲突在两边收敛出不同结果。
 */
export { cx } from '../../vendor/boardui/utils/cx';
