/**
 * 告警模块的共享控件入口（按 `docs/frontend-module-conventions.md`）。
 *
 * 只 re-export 来自 `~/components/admin` 的共享控件与常量；内部文件统一从本文件
 * 取，不直接连 `~/components`。
 */
export { ALERT_SEVERITY_META, alertTime } from '~/components/admin/AlertCenter';
