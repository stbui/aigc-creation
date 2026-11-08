/**
 * 商品换色页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute('/product-recolor', ..., 'ProductRecolorPage')`),
 * 必须具名导出页面组件。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数 `./utils`、常量 `./constants`。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
import './style.css';
export { ProductRecolorPage } from './page';
