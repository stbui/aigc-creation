/**
 * 商品 SKU 图工作台页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute('/product-sku', ..., 'ProductSkuPage')`),
 * 必须具名导出页面组件。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数与外部工具 `./utils`、常量与类型 `./constants`。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
import './style.css';
export { ProductSkuPage } from './page';
