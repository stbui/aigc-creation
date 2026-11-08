/**
 * 创意生图 / 自由创作工作台页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute(...)`), 必须具名导出页面组件。
 * `/creative-image` 传入 `capability="creative_image"`; 保留的 `/free-creation`
 * 不传参, 由页面回落到自由创作 (兼容旧的 `?capability=creative_image`)。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数与外部工具 `./utils`、常量与类型 `./constants`。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
import './style.css';
export { CreativeImagePage } from './page';
