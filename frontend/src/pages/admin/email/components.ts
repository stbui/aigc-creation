/**
 * 邮箱配置模块的外部控件唯一入口（按 `docs/design/standards/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的 `~/admin-ui/radar` 控件。目录内文件一律从
 * `./components` 取控件，不直连 `~/admin-ui`；本模块自有业务组件（概览卡、
 * 通道选择、业务事件、测试发信、设置字段、模板面板、各标签页）仍由各文件
 * 直接 `./Xxx` 引用，不在此聚合，避免循环引用。
 *
 * 工具函数（`cn` / 通道标签 / 模板占位符）走 `./utils`，hook 走 `./hooks`，
 * 类型走 `./types`。
 */

export {
  ActionButton,
  AdminPage,
  AdminTabs,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  FormDrawer,
  FormField,
  ListError,
  MiniStat,
  Notice,
  NumberField,
  PageSkeleton,
  Panel,
  SaveBar,
  SelectField,
  SkeletonPanel,
  StaleError,
  SwitchField,
  TabsContent,
  TextAreaField,
  TextField,
  ToneBadge,
} from '~/admin-ui/radar';

/* 跨页共用的后台组件（消息通知页使用同一个测试发信面板） */
export { TestEmailPanel } from '~/components/admin/TestEmailPanel';
