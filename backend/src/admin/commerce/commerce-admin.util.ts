import { AppError } from "../../common/app.exception";

/**
 * 一笔订单的退款状态（列表列展示用）。
 *
 * 一笔订单可能有多笔退款单（部分退款会按笔落库），同一笔退款的渠道重试
 * 则是同一行改状态。列上只显示一个值，取**最需要人管的那个**：
 * 处理中 > 失败 > 成功。
 *
 * 为什么不是「最新一笔」：筛选 `?refundState=failed` 用的是 `some` 命中任意
 * 一笔退款单，列若只取最新一笔，运营按「退款失败」筛出来会看到空的列 ——
 * 列与筛选条件不同源。取聚合值保证「筛得到的每一行，列上一定看得到原因」。
 */
export function latestRefundState(
  refunds: Array<{ status: string }>,
): "processing" | "failed" | "succeeded" | null {
  let state: "processing" | "failed" | "succeeded" | null = null;
  for (const refund of refunds) {
    if (refund.status === "processing") return "processing";
    if (refund.status === "failed") state = "failed";
    else if (refund.status === "succeeded" && !state) state = "succeeded";
  }
  return state;
}

/**
 * 订单「实付」的唯一口径（列表 / 详情 / 导出共用）。
 *
 * 历史订单没有写入 `paidCents` 快照，直接展示会是 0 元；但**真正的 0 元单**
 * （100% 券/活动、免费领取）也必须显示 0，不能回落成原价，否则运营会以为
 * 用户付过钱、甚至对一个免费单发起退款。
 *
 * 区分办法与 C 端 `OrderService.toOrderView` 一致：看有没有 `channel=free`
 * 的成功流水。此前只有列表做了回落、详情返回原始值，同一笔订单在列表和抽屉
 * 里出现两个数字（见 2026-11-11 订单页审查 P1-1），所以收敛到这里一处实现。
 */
export function effectivePaidCents(order: {
  paidCents: number;
  totalCents: number;
  payments?: Array<{ status: string; channel: string }>;
}): number {
  if (order.paidCents > 0) return order.paidCents;
  const freePaid = (order.payments ?? []).some(
    (payment) => payment.status === "succeeded" && payment.channel === "free",
  );
  return freePaid ? 0 : order.totalCents;
}

/**
 * 解析 `from` / `to` 为 createdAt 过滤条件。
 *
 * `to` 含当天: 运营输入 2026-10-21 想看到的是这一整天, 而不是 00:00:00
 * 之前。只写日期的值补到 23:59:59.999。
 * 非法日期直接 400 —— 静默忽略会让导出结果与筛选条件不符且看不出来。
 *
 * ## 日期必须按**业务时区**解释，不能按服务器本地时区
 *
 * 只写日期的值原先是 `new Date('2026-10-21T00:00:00.000')`，由 Node 按
 * 进程时区解释：本机是 CST 时行为正确，但容器默认 UTC，同一个筛选会在
 * 生产环境偏移 8 小时——「今天」的订单里 00:00–08:00 下的单全部漏掉，
 * 而页面上写的还是「日期筛选含结束当天」。这里显式带 `+08:00`，
 * 结果与部署环境无关。
 */
export function dateRange(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } | undefined {
  const parse = (raw: string | undefined, endOfDay: boolean): Date | undefined => {
    if (!raw?.trim()) return undefined;
    const value = raw.trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(
      dateOnly
        ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`
        : value,
    );
    if (Number.isNaN(date.getTime())) {
      throw new AppError(40001, `日期格式非法: ${value}`, 400);
    }
    return date;
  };
  const gte = parse(from, false);
  const lte = parse(to, true);
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

/**
 * 后台输入的时间按 Asia/Shanghai 解释，数据库存 UTC。
 *
 * 接受 `yyyy-mm-dd`、`yyyy-mm-ddTHH:mm`（datetime-local 的原生格式）与
 * `yyyy-mm-dd HH:mm`；不带时区的值补 `+08:00`，不是交给 `new Date` 按
 * 服务器本地时区猜 —— 容器通常在 UTC，猜出来会整体偏 8 小时。
 */
export function parseShanghai(value: unknown): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)
      ? `${text}:00+08:00`
      : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)
        ? `${text.replace(" ", "T")}:00+08:00`
        : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(40001, `时间格式非法: ${text}`, 400);
  }
  return date;
}
