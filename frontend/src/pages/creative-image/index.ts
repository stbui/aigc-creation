/**
 * 自由创作工作台页面入口（唯一路由 `/free-creation`）。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute(...)`), 必须具名导出页面组件。
 * 页面固定提交 `free_create`，不再接收 capability 参数、不读取查询参数。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数与外部工具 `./utils`、常量与类型 `./constants`。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
import './style.css';
export { CreativeImagePage } from './page';
