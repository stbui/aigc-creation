/**
 * 后台财务分析接口（`/api/v1/admin/analytics/finance`）。
 *
 * 只读聚合，权限点用 `model.analytics_read`（与渠道 / 路由观测同一档）：
 * 金额口径属于运营敏感数据，不能挂在只读账单权限之外随便下放。
 *
 * 查询参数用裸 `@Query()` 取而不是 DTO：区间只有 `from` / `to` 两个字符串，
 * 非法值由 service 抛 400 并指名格式 —— 与账单列表页的筛选写法保持一致。
 */

import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { FinanceAnalyticsService, type FinanceAnalyticsView } from './finance-analytics.service';

@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly finance: FinanceAnalyticsService) {}

  /** 财务汇总：区间总额、按日趋势、按模型 / 渠道 / 能力 / 场景 Top 10 */
  @Get('finance')
  @RequirePermission(PERMISSIONS.modelAnalyticsRead)
  summary(@Query('from') from?: string, @Query('to') to?: string): Promise<FinanceAnalyticsView> {
    return this.finance.summary({ from, to });
  }
}
