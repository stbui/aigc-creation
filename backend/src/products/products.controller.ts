import { Controller, Get, Param } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * C 端商品接口 (**公开, 免登录**)。
 *
 * 与 `/capabilities` 同口径: 落地页与商城页要在登录墙之前就渲染价目,
 * 否则用户没登录就看不到卖什么, 转化链路断在第一步。
 *
 * ⚠ 此处**不得加 JwtAuthGuard** —— 加了就等于把价目锁在登录后,
 * 破坏的就是上面那条转化链路。
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** 在售商品列表 */
  @Get()
  list() {
    return this.products.listActive();
  }

  /** 商品详情 */
  @Get(':sku')
  detail(@Param('sku') sku: string) {
    return this.products.detailBySku(sku);
  }
}