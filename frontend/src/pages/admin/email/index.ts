/**
 * 独立邮箱配置目录的对外出口（按 `docs/design/standards/frontend-module-conventions.md`）。
 *
 * 外部（后台路由、测试）只从 `./email` 取 `AdminEmailPage`。
 * 目录内共享控件经 `components.ts`、接口经 `api.ts`、hook 经 `hooks.ts`、
 * 工具经 `utils.ts`、常量经 `constants.ts` 取用；各业务组件直接 `./Xxx` 引用。
 *
 * 样式表只在此处引入一次：目录内每个文件各引一次会让同一份 CSS 重复进入构建
 * 图，且谁也说不清到底哪一层依赖了后台样式。
 */
import '../../../styles/radar-admin.css';
export { AdminEmailPage } from './page';

/**
 * 跨模块共享的邮件文案/通道标签 helper —— 供 notifications 等兄弟模块经本入口取用，
 * 避免其直接穿透 `../email/constants`（违反目录隔离）。
 *
 * 唯一位于 `page` 之外的出口：这两个函数是同模块对外承诺的一部分，不属于页面；
 * 它们已随本轮改造从 `constants.ts` 迁到 `utils.ts`（纯函数归 utils）。
 */
export { deliveryProviderLabel, emailErrorText } from './utils';
