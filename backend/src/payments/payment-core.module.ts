import { Module } from '@nestjs/common';
import { PaymentCipher } from './payment-cipher';
import { PaymentConfigAdminService } from './payment-config-admin.service';
import { PaymentConfigService } from './payment-config.service';
import { PaymentConfigStore } from './payment-config-store';
import { PaymentExceptionService } from './payment-exception.service';
import { PaymentGateway } from './payment-gateway';
import { PaymentRoutingService } from './payment-routing.service';

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
 *
 * 配置服务按平面拆成三个内部 provider（store / **console** / routing），
 * 只导出 `PaymentConfigService` 门面；外部模块不直接注入子服务，
 * 内部拆分才不会外溢成调用方的改动。
 */
@Module({
  providers: [
    PaymentCipher,
    PaymentConfigStore,
    PaymentConfigAdminService,
    PaymentRoutingService,
    PaymentConfigService,
    PaymentGateway,
    PaymentExceptionService,
  ],
  exports: [PaymentCipher, PaymentConfigService, PaymentGateway, PaymentExceptionService],
})
export class PaymentCoreModule {}
