/**
 * 调用记录的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/model`、`lib/api`）在此统一 re-export，业务文件一律从
 * `./types` 取；本目录派生的筛选形状也定义于此。
 */

/* 外部类型统一转出 */
export type { ApiLogDetailView, ApiLogListResult, ApiLogView } from '../../../types/model';

/**
 * 筛选条上的 11 个条件值，同时充当「已生效条件 → 请求参数」的载体。
 *
 * 草稿态（输入框里正在编辑的值）与已生效态（`useAdminList` 的 `params`）共用
 * 同一形状：下拉项与日期用空串 / `undefined` 表示「未选」，ID 类输入框用空串
 * 表示「未填」。两态同形，`applyFilters` 才能原样搬运而不必逐字段翻译。
 *
 * 必须是 `type` 而不是 `interface`：`useAdminList` / `useAdminUrlFilterSync`
 * 的入参是 `Record<string, unknown>`，只有类型别名才会生成隐式索引签名，
 * `interface` 会因「缺少索引签名」被拒。
 *
 * 字段与 `lib/api` 的 `AdminApiLogQuery` 一一对应 —— 后者由
 * `adminApiLogsApi.list` / `exportCsv` 在调用处做结构化校验，这里不再重复
 * 声明一份接口。
 */
export type ModelCallFilterValues = {
  status?: string;
  requestKind?: string;
  source?: string;
  operation?: string;
  billable?: string;
  model: string;
  channelId: string;
  taskId: string;
  userId: string;
  from: string;
  to: string;
};
