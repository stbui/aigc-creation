/**
 * 后台可观测性：上游调用记录与财务分析。
 *
 * 从 `api.ts` 拆出 —— 两者都是只读聚合（调用日志 / 实收-已退-净收入），
 * 与用户、商品、渠道这些写接口不同类。`api.ts` 仍聚合转出，调用方无需改 import。
 */
import { downloadCsv, request, toQuery } from './api';
import type { ApiLogDetailView, ApiLogListResult, FinanceAnalyticsView } from '../types/model';

/** 调用记录的筛选条件：列表与导出共用（导出忽略分页） */
export interface AdminApiLogQuery {
  status?: string;
  requestKind?: string;
  source?: string;
  operation?: string;
  channelId?: string;
  taskId?: string;
  userId?: string;
  model?: string;
  billable?: string;
  from?: string;
  to?: string;
}

/** 上游调用记录（`ApiCallLog` 维度，含后台连通性测试的非计费调用） */
export const adminApiLogsApi = {
  list: (params: AdminApiLogQuery & { page?: number; pageSize?: number } = {}) =>
    request<ApiLogListResult>(`/admin/api-logs${toQuery(params)}`),

  /**
   * 单条调用详情（含请求 / 响应报文）。
   *
   * 报文只在详情里下发：列表一次几十行，每条都可能带上百 KB 的上游响应，
   * 为了展示「状态与耗时」不值得整页读一遍大字段。
   */
  detail: (id: string) =>
    request<ApiLogDetailView>(`/admin/api-logs/${encodeURIComponent(id)}`),

  /**
   * 导出当前筛选结果（CSV，上限 5000 行）。
   *
   * 刻意不含请求体 / 响应体：那是排查用的明细，落成可转发的文件就等于把上游密钥
   * 片段与用户提示词一起散出去。需要看细节走详情抽屉。
   */
  exportCsv: (params: AdminApiLogQuery = {}) =>
    downloadCsv(`/admin/api-logs/export${toQuery(params)}`),
};

/** 财务分析（只读聚合）：实收 / 已退 / 净收入，未结算单独列为挂账 */
export const adminAnalyticsApi = {
  finance: (params: { from?: string; to?: string } = {}) =>
    request<FinanceAnalyticsView>(`/admin/analytics/finance${toQuery(params)}`),
};
