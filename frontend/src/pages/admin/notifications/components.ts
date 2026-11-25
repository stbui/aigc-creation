/**
 * 消息通知模块的外部控件唯一入口（按 `docs/design/standards/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的 `~/admin-ui/radar` 控件；目录内文件一律从
 * `./components` 取控件，不直连 `~/admin-ui`。模块自有业务组件
 * （通道状态、测试发信、广播、模板抽屉、列定义）由各文件直接 `./Xxx` 引用。
 *
 * 工具函数走 `./utils`，接口走 `./api`，hook 走 `./hooks`，常量走 `./constants`。
 */

export {
  ActionButton,
  AdminDataTable,
  AdminPage,
  FormDrawer,
  FormField,
  MiniStat,
  Notice,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  SwitchField,
  TextAreaField,
  TextField,
  type AdminColumn,
} from '~/admin-ui/radar';

/* 跨页共用的后台组件（邮箱配置页使用同一个测试发信面板） */
export { TestEmailPanel } from '~/components/admin/TestEmailPanel';
