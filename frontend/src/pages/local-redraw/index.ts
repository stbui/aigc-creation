/**
 * 局部重绘页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute('/local-redraw', ..., 'LocalRedrawPage')`),
 * 必须具名导出页面组件。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数 `./utils`、常量与类型 `./constants`；本页独有的
 * 画布组件是 `./MaskPainter`。分层约定见 `docs/frontend-module-conventions.md`。
 */
export { LocalRedrawPage } from './page';
