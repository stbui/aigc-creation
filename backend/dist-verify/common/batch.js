"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BATCH_LIMIT = void 0;
exports.runBatch = runBatch;
const app_exception_1 = require("./app.exception");
/**
 * 后台批量操作（B7）。
 *
 * ## 为什么是「逐条执行 + 逐条结果」而不是一个事务
 *
 * 批量禁用 50 个账号时，其中 3 个是管理员、1 个已被注销 —— 这是常态，
 * 不是异常。整批回滚会让运营「挑了 50 个，一个都没成功」，还得自己
 * 逐个试出是哪 4 个不行；逐条执行则明确回答「这 46 个成了，这 4 个
 * 为什么没成」。批量操作的价值在于省点击，不在于把失败也变成原子性。
 *
 * ## 为什么串行
 *
 * SQLite 是单写者：并发写入会直接撞 `SQLITE_BUSY`。串行 100 条的单行
 * 更新在本机是毫秒级，并发带来的复杂度（重试、退避、部分锁）换不来
 * 任何可感知的收益，反而会让"第几条失败"变得难以复现。
 *
 * ## 上限 100
 *
 * 再大应当走导入/导出任务，而不是一个可能超时的同步请求。上限放在
 * 这里而不是各控制器 —— 各写一份时总有一处会漏。
 */
exports.BATCH_LIMIT = 100;
/**
 * 逐条执行批量动作。
 *
 * @param ids 目标 id 列表（自动去重、去空白）
 * @param run 单条动作。抛异常即视为该条失败，`message` 取异常信息。
 */
async function runBatch(ids, run) {
    const list = [...new Set((ids ?? []).map((s) => String(s ?? '').trim()).filter(Boolean))];
    if (list.length === 0) {
        throw new app_exception_1.AppError(40001, '请至少选择一条记录', 400);
    }
    if (list.length > exports.BATCH_LIMIT) {
        throw new app_exception_1.AppError(40001, `单次批量最多 ${exports.BATCH_LIMIT} 条（当前 ${list.length} 条）`, 400);
    }
    const results = [];
    for (const id of list) {
        try {
            results.push({ id, ok: true, data: await run(id) });
        }
        catch (e) {
            results.push({
                id,
                ok: false,
                // 只保留前 200 字：逐条原因是给人看的，不是堆栈
                message: String(e?.message ?? e).slice(0, 200),
            });
        }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { total: results.length, succeeded, failed: results.length - succeeded, results };
}
//# sourceMappingURL=batch.js.map