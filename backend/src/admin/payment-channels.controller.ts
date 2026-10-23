import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { PaymentProviderFactory } from '../payments/payment.factory';
import { PaymentsService } from '../payments/payments.service';
import { PaymentChannel } from '../payments/payment-provider.interface';

/** 通道中文名。只用于展示, 通道白名单本身在 payment-provider.interface.ts */
const CHANNEL_LABELS: Record<PaymentChannel, string> = {
  sandbox: '沙箱（站内模拟）',
  alipay: '支付宝（网页支付）',
  wechat: '微信支付（Native 扫码）',
};

/**
 * 支付渠道状态 (只读)。
 *
 * 与「存储配置」页同一套安全边界: **凭据只从部署环境变量读, 界面不提供编辑**。
 * 本页只回答三个问题:
 *   1. 当前生效的是哪条通道 (PAYMENT_PROVIDER);
 *   2. 每条通道的凭据齐不齐, 缺哪些变量名 (只给变量名, 绝不回传值);
 *   3. 这套配置在当前环境会不会出事 (如生产仍走沙箱、真实通道回调地址不可达)。
 *
 * 为什么值得单独一页: 支付通道配错的典型表现是**静默**的 —— 生产仍走沙箱时
 * 用户支付「成功」但账上一分钱没有; 真实通道缺凭据时发起支付直接 503。
 * 两种情况都不会在订单列表里留下异常, 只有专门看这一屏才能发现。
 *
 * 数据来源不新造: 通道清单与凭据判定复用 `PaymentProviderFactory.status()`,
 * 回调地址复用 `PaymentsService.notifyUrl()`, 避免页面与实际支付链路各说各话。
 */
@Controller('admin/payment-channels')
export class AdminPaymentChannelsController {
  constructor(
    private readonly factory: PaymentProviderFactory,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.paymentRead)
  status() {
    const active = this.factory.configuredChannel();
    const env = process.env.NODE_ENV || 'development';

    const channels = this.factory.status().map((c) => ({
      ...c,
      label: CHANNEL_LABELS[c.channel],
      // 沙箱没有渠道侧回调 —— 它是站内模拟, 给个地址反而让人以为要去配置
      notifyUrl: c.channel === 'sandbox' ? null : this.payments.notifyUrl(c.channel),
    }));

    const activeChannel = channels.find((c) => c.channel === active)!;
    const warnings: Array<{ level: 'danger' | 'warn'; message: string }> = [];

    /*
     * 真实通道缺凭据: 发起支付会 503。这里必须给 danger ——
     * 用户侧看到的是「支付按钮点了报错」, 不会有人去翻环境变量。
     */
    if (!activeChannel.configured) {
      warnings.push({
        level: 'danger',
        message:
          `当前通道「${activeChannel.label}」凭据不全（缺 ${activeChannel.missing.join(', ')}），` +
          '发起支付将返回 503。按 payment.factory.ts 的约定，缺凭据绝不静默降级为沙箱。',
      });
    }

    /*
     * 生产仍走沙箱: 比缺凭据更危险 —— 链路全通, 只是没有真实资金。
     */
    if (active === 'sandbox' && env === 'production') {
      warnings.push({
        level: 'danger',
        message:
          '生产环境仍使用沙箱通道，不会产生真实资金流转。上线前必须把 PAYMENT_PROVIDER 切到 alipay / wechat 并配齐凭据。',
      });
    }

    /*
     * 真实通道 + 未配回调基址: 回落到 HOST:PORT, 多半是 127.0.0.1 ——
     * 渠道服务器访问不到, 表现为「用户付了钱, 订单永远 pending」。
     */
    if (active !== 'sandbox' && !process.env.PAYMENT_NOTIFY_BASE) {
      warnings.push({
        level: 'warn',
        message:
          '未配置 PAYMENT_NOTIFY_BASE，回调地址回落到 HOST:PORT。该地址必须能被支付宝 / 微信服务器公网访问，' +
          '否则用户付款后订单不会自动变为已支付。',
      });
    }

    return {
      active,
      environment: env,
      channels,
      credentialSource: '环境变量（PAYMENT_PROVIDER / ALIPAY_* / WECHAT_* / PAYMENT_NOTIFY_BASE）',
      /** 与存储配置页同一表态: 界面不可编辑凭据 */
      editable: false,
      warnings,
    };
  }
}
