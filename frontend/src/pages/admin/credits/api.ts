/**
 * 积分账本的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定：`credits/` 下的文件不从 `src/lib/api` 直接取东西，一律经由本文件。
 * 目录内新增接口引用时在这里补一行 re-export。
 *
 * 类型契约在 `src/types/api.ts`（纯类型模块，各文件可直接 `import type`）。
 */

export { adminCreditsApi, newIdempotencyKey } from '../../../lib/api';
