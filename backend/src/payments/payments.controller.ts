import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AppError } from '../common/app.exception';
import { SettingsService } from '../common/settings.service';
import { PaymentOrderService } from './payment-order.service';
import { PaymentConfigService } from './payment-config.service';
import { PaymentNotificationService } from './payment-notification.service';
import { getAdapter } from './adapters';
import { PAYMENT_CURRENCIES, PaymentCurrency, PaymentProviderId } from './adapters/types';

export class CreateIntentDto {
  /** 渠道 id。多个可用渠道时必传 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  providerId?: string;
}

/**
 * C 端支付接口。
 *
 * `/payments/callback/:providerId/:configId` 是**公开**路由 —— 渠道服务器不带
 * 我们的 JWT，身份靠验签证明。它绝不能挂 JwtAuthGuard，也不能依赖「谁能调通」
 * 判断请求是否可信。
 */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly orders: PaymentOrderService,
    private readonly configs: PaymentConfigService,
    private readonly notifications: PaymentNotificationService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * C 端支付设置：默认币种 + 该币种下可用渠道。
   *
   * 公开接口：商品页/结算页在登录前就要按默认币种排序与过滤。
   * 不返回任何凭据；渠道字段由 PaymentConfigService 的公开视图裁剪。
   */
  @Get('settings')
  async settingsView() {
    const currency = await this.settings.get<string>('payment.defaultCurrency');
    const target = this.normalizeCurrency(String(currency || 'CNY'));
    const providers = await this.configs.available(target);
    return { defaultCurrency: target, providers };
  }

  /** 可选支付渠道（按订单币种或指定币种过滤） */
  @Get('providers')
  @UseGuards(JwtAuthGuard)
  async providers(@Query('currency') currency?: string) {
    const target = this.normalizeCurrency(currency);
    const items = await this.configs.available(target);
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  /** 发起支付：返回跳转地址或二维码内容 */
  @Post(':orderId/intent')
  @UseGuards(JwtAuthGuard)
  createIntent(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateIntentDto,
    @Req() req: Request,
  ) {
    return this.orders.createIntent({
      orderId,
      userId: user.id,
      providerId: dto.providerId,
      clientIp: normalizeClientIp(req.ip || req.socket?.remoteAddress),
    });
  }

  /** 支付状态轮询 */
  @Get(':orderId/status')
  @UseGuards(JwtAuthGuard)
  status(@Param('orderId') orderId: string, @CurrentUser() user: AuthUser) {
    return this.orders.query({ orderId, actor: { kind: 'user', userId: user.id } });
  }

  /** 主动查单（刷新动作，不是状态变更） */
  @Post(':orderId/query')
  @UseGuards(JwtAuthGuard)
  query(@Param('orderId') orderId: string, @CurrentUser() user: AuthUser) {
    return this.orders.query({
      orderId,
      actor: { kind: 'user', userId: user.id },
      force: true,
    });
  }

  /**
   * 渠道异步回调。
   *
   * 必须用**原始报文**验签（微信签名覆盖 body 字节；支付宝表单参数经 URL
   * 解码后拼串），故 main.ts 建应用时开启了 `rawBody: true`。
   *
   * 响应格式由通道决定（支付宝纯文本 / 微信 JSON），用 @Res 直接写，
   * 不经过统一响应信封 —— 渠道不认识 `{code,data,message}`。
   */
  @Get('callback/:providerId/:configId')
  async callbackGet(
    @Param('providerId') providerId: string,
    @Param('configId') configId: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const body = query ?? {};
    await this.handleCallback(
      providerId,
      configId,
      req.headers as Record<string, string | string[] | undefined>,
      Buffer.from(JSON.stringify(body)),
      body,
      res,
    );
  }

  @Post('callback/:providerId/:configId')
  async callbackPost(
    @Param('providerId') providerId: string,
    @Param('configId') configId: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const rawBody = req.rawBody
      ? req.rawBody
      : Buffer.from(typeof body === 'object' && body !== null ? JSON.stringify(body) : '');

    await this.handleCallback(
      providerId,
      configId,
      req.headers as Record<string, string | string[] | undefined>,
      rawBody,
      body ?? {},
      res,
    );
  }

  private async handleCallback(
    providerId: string,
    configId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    body: Record<string, unknown>,
    res: Response,
  ): Promise<void> {
    if (!getAdapter(providerId)) {
      throw new AppError(40400, `未知支付渠道: ${providerId}`, 404);
    }

    const ack = await this.notifications.ingest({
      providerId: providerId as PaymentProviderId,
      configId,
      headers,
      rawBody,
      body,
    });

    res.status(ack.status);
    res.setHeader('Content-Type', ack.contentType);
    res.send(ack.body);
  }

  private normalizeCurrency(currency?: string): PaymentCurrency {
    if (!currency) return 'CNY';
    if (!(PAYMENT_CURRENCIES as string[]).includes(currency)) {
      throw new AppError(40001, `不支持的币种: ${currency}`, 400);
    }
    return currency as PaymentCurrency;
  }
}

/** ZPay 要求 clientip 必须来自服务端可验证的请求上下文，不能信任请求体。 */
export function normalizeClientIp(raw?: string): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const candidate = value.startsWith('::ffff:') ? value.slice(7) : value;
  return isIP(candidate) ? candidate : undefined;
}

/**
 * 用户取消未支付订单。
 *
 * 独立成 controller 而不是塞回 `OrdersController`：取消订单现在必须**先向
 * 渠道查单**（渠道可能已经收了钱），这条链路依赖支付域；让订单域反向依赖
 * 支付域会形成循环。路由仍是 `POST /orders/:id/cancel`，对前端无感。
 */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderCancelController {
  constructor(private readonly orders: PaymentOrderService) {}

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.close({ orderId: id, actor: { kind: 'user', userId: user.id }, reason: '用户取消' });
  }
}
