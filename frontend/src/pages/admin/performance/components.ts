/**
 * 系统信息模块的外部控件唯一入口（按 `docs/design/standards/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本模块用到的 `~/admin-ui/radar` 控件，目录内文件一律从
 * `./components` 取控件，不直连 `~/admin-ui`。格式化与阈值判定等纯函数走
 * `./utils`，两者分工不同：控件管外观，utils 管读数怎么读。
 */

export {
  AdminPage,
  cn,
  EmptyState,
  ListError,
  Meter,
  Notice,
  Panel,
  RefreshButton,
  SkeletonPanel,
  StaleError,
} from '~/admin-ui/radar';
export { STATUS_META } from '~/components/admin/statusMeta';
