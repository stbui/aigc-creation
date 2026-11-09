/**
 * 告警与待办共用的阈值。
 *
 * 告警中心（`GET /admin/alerts`）与角色工作台（`GET /admin/workbench`）读同一批
 * 业务状态。阈值若各写一份，最先漂移的一定是「铃铛显示 3 条、工作台显示 2 条」，
 * 而运营会先怀疑数据本身有问题。所有窗口与分界值只在这里定义。
 */

/** 运行中任务超过此值即视为积压，与任务监控页保持同一阈值 */
export const RUNNING_ALERT_THRESHOLD = 50;

/** 近 24 小时失败任务达到此值升为 critical */
export const FAILED_CRITICAL_THRESHOLD = 10;

/** 工单等待超过此小时数升为 critical */
export const TICKET_CRITICAL_HOURS = 24;

/** 备份超过此小时数未成功即告警 */
export const BACKUP_STALE_HOURS = 48;

/**
 * 渠道异步退款超过此分钟数仍未落账即告警。
 *
 * 微信 v3 可能在受理后退回 PROCESSING，本仓库没有退款回调端点，订单状态
 * 与积分都不会自动变更。门槛不能太短，否则刚提交、下一分钟就可能完成的
 * 异步退款也会被算成故障。
 */
export const REFUND_STUCK_MINUTES = 30;

/** 退款卡单超过此小时数升为 critical */
export const REFUND_CRITICAL_HOURS = 24;

/** 对账差异达到此笔数升为 critical */
export const RECONCILIATION_CRITICAL_COUNT = 5;

/**
 * 结果不明账单（`42206`）达到此笔数升为 critical。
 *
 * 这类账单既不切线也不退款：上游可能已经把图生成了，自动退款会白送一次产出，
 * 自动结算则可能多收钱。每一笔都占着用户的预授权额度，必须人工核对。
 */
export const UNCERTAIN_BILLING_CRITICAL_COUNT = 5;

/** 结果不明账单挂账超过此小时数升为 critical（额度长期冻结同样构成事故） */
export const UNCERTAIN_BILLING_CRITICAL_HOURS = 24;

/** 工作台每类最多返回的实体行数 */
export const WORKBENCH_ITEMS_PER_GROUP = 5;

/** 告警与工作台共用的缓存时长 */
export const ALERT_CACHE_TTL_MS = 30_000;
