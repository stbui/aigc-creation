import { Module } from '@nestjs/common';
import { PaymentProviderFactory } from './payment.factory';

/**
 * 支付通道的**叶子模块**（2026-10-22）。
 *
 * 为什么单独拆出来：退款要由 `OrderService` 发起（状态机与积分回收都在订单域），
 * 而订单域原来不依赖支付域。直接让 `OrdersModule` 去 import `PaymentsModule`
 * 会形成 `PaymentsModule → OrdersModule → PaymentsModule` 的循环 ——
 * Nest 启动即报 `UndefinedDependency`，且报错指向的不是真正的成因。
 *
 * `PaymentProviderFactory` 本身不依赖任何东西（构造器里只是 new 出三个通道实现），
 * 是天然的叶子。拆到独立模块后两边都能用，依赖方向仍然单向：
 *
 *   PaymentsModule ─┐
 *                   ├─→ PaymentCoreModule (通道工厂)
 *   OrdersModule ───┘
 */
@Module({
  providers: [PaymentProviderFactory],
  exports: [PaymentProviderFactory],
})
export class PaymentCoreModule {}
