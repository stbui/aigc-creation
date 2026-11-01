/**
 * 一键抠图页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute('/background-remove', ..., 'BackgroundRemovePage')`),
 * 必须具名导出页面组件。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数 `./utils`、常量 `./constants`；本页独有的预览组件是
 * `./BackgroundSourcePreview`。分层约定见 `docs/frontend-module-conventions.md`。
 */
export { BackgroundRemovePage } from './page';
