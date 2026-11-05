/**
 * 积分账本的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定:
 *   - 本文件内的函数不依赖 React，可被页面、组件与 hooks 共用；
 *   - 目录内文件不从 `src/lib/<工具>` 直接取东西，一律经由本文件；
 *   - 常量、类型与默认值在 `constants.ts`，外部接口 / 控件 / hook 分别走
 *     `api.ts` / `components.ts` / `hooks.ts`。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/* 外部工具转出：目录内文件不直接引 `src/lib/*` */
export { cn } from '../../../admin-ui/lib/cn';
export {
  adminOrderHref,
  adminTasksHref,
  adminUserDetailHref,
} from '../../../lib/admin-links';

/** 带符号的积分文本: 正数显式加号, 否则扫视时看不出是增还是减 */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** 后台统一的时间展示；空值显示破折号，不用空白单元格 */
export { formatDateTimeLoose as fmtTime } from '../../../admin-ui/primitives';
