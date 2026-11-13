/**
 * 商品主图工作台页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute('/product-kit', ..., 'ProductKitPage')`),
 * 必须具名导出页面组件。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、后端接口 `./api`、
 * hook `./hooks`、纯函数与外部工具 `./utils`、常量与类型 `./constants`。
 * 页面结构按左右栏拆分 (`ProductKitInputPane` + 共享 `ToolBatchOutputPane`),
 * 生成提交流程单独收在 `useProductKitSubmit.ts`，由 `page.tsx` 直接引用
 * （它同时依赖 api / utils，不再经 `./hooks` 转一层）。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
import '../../styles/product-detail-kit.css';
export { ProductKitPage } from './page';
