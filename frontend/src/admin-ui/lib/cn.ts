import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 类名合并。
 *
 * ## 两份实现的分工
 *
 * `cx` —— BoardUI vendor 的 `twMerge` 包装，**行为与上游逐字一致**。
 * `admin-ui` 与 `pages/admin` 现有 20 处导入全部走它，入参都是纯字符串，
 * 升级 vendor 时可原样覆盖，故直接 re-export，不做包装。
 *
 * `cn` —— shadcn/ui 的调用约定（`cn(...inputs)`），供 `components/ui/` 下的
 * 组件使用。必须先 clsx 展开、再 twMerge 收敛：shadcn 组件按 clsx 约定传入
 * 条件对象（`cn('p-2', { 'p-4': isActive })`），而 tailwind-merge 单独用会
 * **丢掉**条件对象 —— 实测 `twMerge([{ 'p-4': true }])` 与
 * `twMerge([{ 'p-4': false }])` 都返回空串，条件类一律消失。
 */
export { cx } from '../../vendor/boardui/utils/cx';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
