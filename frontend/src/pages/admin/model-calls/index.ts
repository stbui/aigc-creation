/**
 * 上游调用记录目录的对外出口（按 `docs/frontend-module-conventions.md`）。
 *
 * 外部（后台路由、测试）只从 `./model-calls` 取 `AdminModelCallsPage`。
 * 目录内共享控件经 `components.ts`、接口经 `api.ts`、hook 经 `hooks.ts`、
 * 工具经 `utils.ts`、常量经 `constants.ts` 取用；各业务组件直接 `./Xxx` 引用。
 *
 * 样式表只在此处引入一次：目录内每个文件各引一次会让同一份 CSS 重复进入构建
 * 图，且谁也说不清到底哪一层依赖了后台样式。
 */
import '../../../styles/radar-admin.css';
export { AdminModelCallsPage } from './page';
