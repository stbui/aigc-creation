/**
 * 用户管理目录的对外出口（按 `docs/frontend-module-conventions.md`）。
 *
 * 外部（后台路由、测试）只从 `./users` 取 `AdminUsersPage`（页面唯一出口）。
 * 目录内共享控件经 `components.ts`、接口经 `api.ts`、hook 经 `hooks.ts`、
 * 工具经 `utils.ts`、常量经 `constants.ts` 取用；各业务组件直接 `./Xxx` 引用。
 */
import '../../../styles/radar-admin.css';
export { AdminUsersPage } from './page';
