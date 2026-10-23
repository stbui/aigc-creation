import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { AlipayPaymentProvider } from './alipay.provider';
import {
  PAYMENT_CHANNELS,
  PaymentChannel,
  PaymentProvider,
  isPaymentChannel,
} from './payment-provider.interface';
import { SandboxPaymentProvider } from './sandbox.provider';
import { WechatPaymentProvider } from './wechat.provider';

/**
 * 通道工厂。
 *
 * 选路规则: `PAYMENT_PROVIDER` (默认 sandbox)。
 *
 * 铁律: **凭据缺失时返回 503, 绝不静默降级为沙箱。**
 * 静默降级在生产环境的表现是「用户点支付直接成功、账上一分钱没有」,
 * 比报错严重得多 —— 报错至少会有人来查。
 */
@Injectable()
export class PaymentProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly providers = new Map<PaymentChannel, PaymentProvider>();

  constructor() {
    for (const p of [
      new SandboxPaymentProvider(),
      new AlipayPaymentProvider(),
      new WechatPaymentProvider(),
    ]) {
      this.providers.set(p.channel, p);
    }
  }

  onModuleInit(): void {
    const channel = this.configuredChannel();
    const provider = this.providers.get(channel)!;
    const isProd = process.env.NODE_ENV === 'production';

    if (!provider.isConfigured()) {
      this.logger.error(
        `支付通道 ${channel} 配置不完整, 缺: ${provider.missingConfig().join(', ')} ` +
          `—— 发起支付将返回 503 (不会降级为沙箱)`,
      );
    } else if (channel === 'sandbox') {
      const msg = '支付通道为沙箱 (PAYMENT_PROVIDER=sandbox), 不产生真实资金流转';
      if (isProd) this.logger.error(`${msg} —— 生产环境必须配置真实通道`);
      else this.logger.warn(msg);
    } else {
      this.logger.log(`支付通道: ${channel}`);
    }
  }

  /** 环境变量声明的通道 (非法值回落 sandbox 并告警, 因为 validateEnv 已拦过) */
  configuredChannel(): PaymentChannel {
    const raw = (process.env.PAYMENT_PROVIDER || 'sandbox').trim().toLowerCase();
    if (isPaymentChannel(raw)) return raw;
    this.logger.warn(`PAYMENT_PROVIDER=${raw} 不是已知通道, 已按 sandbox 处理`);
    return 'sandbox';
  }

  /** 当前生效通道。凭据不全时抛 503, 文案直接列出缺哪些变量 */
  active(): PaymentProvider {
    const channel = this.configuredChannel();
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new AppError(50301, `未知支付通道: ${channel}`, 503);
    }
    if (!provider.isConfigured()) {
      throw new AppError(
        50301,
        `支付通道 ${channel} 未完成配置, 暂不可用 (缺少 ${provider.missingConfig().join(', ')})`,
        503,
      );
    }
    return provider;
  }

  /** 回调按 URL 里的 channel 选实现 (与当前生效通道无关: 切换通道后旧回调仍要能处理) */
  byChannel(channel: string): PaymentProvider {
    if (!isPaymentChannel(channel)) {
      throw new AppError(40400, `未知支付通道: ${channel}`, 404);
    }
    const provider = this.providers.get(channel)!;
    if (!provider.isConfigured()) {
      // 回调收到却验不了签 = 无法证明它真的来自渠道, 只能拒掉
      throw new AppError(
        50301,
        `支付通道 ${channel} 未完成配置, 无法校验回调 (缺少 ${provider.missingConfig().join(', ')})`,
        503,
      );
    }
    return provider;
  }

  /** 通道状态 (后台展示用, 不含凭据) */
  status(): Array<{
    channel: PaymentChannel;
    configured: boolean;
    active: boolean;
    missing: string[];
  }> {
    const active = this.configuredChannel();
    return PAYMENT_CHANNELS.map((c) => {
      const p = this.providers.get(c)!;
      return {
        channel: c,
        configured: p.isConfigured(),
        active: c === active,
        missing: p.missingConfig(),
      };
    });
  }
}
