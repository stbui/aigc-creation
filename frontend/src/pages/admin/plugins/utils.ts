/**
 * 外部工具入口 —— 目录内文件的唯一外部工具来源（`src/lib/*` / `src/admin-ui/lib/*`）。
 *
 * 目录内文件不直连 `src/lib` / `src/admin-ui/lib`，一律经由本文件。新增外部工具
 * 引用时在这里补一行 re-export。
 */

export { formatDate, formatDateTime } from '~/admin-ui/radar';
