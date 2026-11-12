/**
 * 网站地图页面入口。
 *
 * `App.tsx` 按路由懒加载 (`lazyRoute('/sitemap.html', ..., 'SitemapPage')`),
 * 必须具名导出页面组件。
 *
 * 目录内文件按类别从入口取: 共享控件 `./components`、hook `./hooks`、
 * 纯函数 `./utils`、常量与静态数据 `./constants`。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 */
import './style.css';
export { SitemapPage } from './page';
