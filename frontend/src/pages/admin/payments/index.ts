/**
 * 支付充值目录的对外出口。
 *
 * 外部（后台路由、测试）只从 `./payments` 取页面；目录内的业务组件、接口、
 * hook、工具与常量分别经 `components.ts` / `api.ts` / `hooks.ts` / `utils.ts` /
 * `constants.ts` 取用。分层约定见 `docs/frontend-module-conventions.md`。
 */
export { AdminPaymentsPage } from './page';
