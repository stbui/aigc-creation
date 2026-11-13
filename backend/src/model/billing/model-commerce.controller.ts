import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { ModelCommerceService } from './model-commerce.service';

@Controller('admin/model-commerce')
export class ModelCommerceController {
  constructor(private readonly commerce: ModelCommerceService) {}

  /** 商品经营总览：调用、净收入、成本、毛利、退款与运营待办计数 */
  @Get('overview')
  @RequirePermission(PERMISSIONS.modelAnalyticsRead)
  overview(@Query('days') days?: string) {
    return this.commerce.overview(days);
  }
}
