/**
 * 系统信息目录的对外出口。
 *
 * 外部（后台路由、测试）只从 `./performance` 取 `AdminPerformancePage`（页面唯一出口）。
 * 目录内共享控件经 `components.ts`、接口经 `api.ts`、hook 经 `hooks.ts`、
 * 类型经 `types.ts` 取用；分层约定见
 * `docs/design/standards/frontend-module-conventions.md`。
 */
import '../../../styles/radar-admin.css';

export { AdminPerformancePage } from './page';
