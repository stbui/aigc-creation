import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentCipher } from './payment-cipher';
import { PaymentConfigService } from './payment-config.service';
import { PaymentGateway } from './payment-gateway';

/**
 * 支付域的**叶子模块**（2026-11 支付重构）。
 *
 * 只包含不依赖订单/后台的组件：配置加密、渠道配置服务、适配器网关。
 * 因此 `PaymentsModule` 与 `OrdersModule` 都可以安全 import 本模块，
 * 而不会形成 `PaymentsModule → OrdersModule → PaymentsModule` 的循环。
 *
 * 依赖方向保持单向：
 *
 *   PaymentsModule ─┐
 *                   ├─→ PaymentCoreModule (配置 + 适配器 + 网关)
 *   OrdersModule ───┘
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [PaymentCipher, PaymentConfigService, PaymentGateway],
  exports: [PaymentCipher, PaymentConfigService, PaymentGateway],
})
export class PaymentCoreModule {}
