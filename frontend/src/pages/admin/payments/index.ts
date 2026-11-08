/**
 * 支付充值目录的对外出口。
 *
 * 外部（后台路由、测试）只从 `./payments` 取页面；目录内的接口、hook、工具与
 * 常量分别经 `api.ts` / `hooks.ts` / `utils.ts` / `constants.ts` 取用。分层约定
 * 见 `docs/frontend-module-conventions.md`。
 */
export { AdminPaymentsPage } from './page';
