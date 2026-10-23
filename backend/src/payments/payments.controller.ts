import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PaymentsService } from './payments.service';

/**
 * 支付接口。
 *
 * `/payments/callback/:channel` 是**公开**路由 —— 渠道服务器不带我们的 JWT,
 * 身份靠验签证明。因此它绝不能挂 JwtAuthGuard, 也绝不能依赖「谁能调通」
 * 来判定请求是否可信。
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** 发起支付: 返回跳转地址或二维码内容 */
  @Post(':orderId/intent')
  @UseGuards(JwtAuthGuard)
  createIntent(@Param('orderId') orderId: string, @CurrentUser() user: AuthUser) {
    return this.payments.createIntent(orderId, user.id);
  }

  /** 支付状态轮询 */
  @Get(':orderId/status')
  @UseGuards(JwtAuthGuard)
  status(@Param('orderId') orderId: string, @CurrentUser() user: AuthUser) {
    return this.payments.status(orderId, user.id);
  }

  /**
   * 渠道异步回调。
   *
   * 必须用**原始报文**验签 (微信的签名覆盖 body 字节; 支付宝的表单参数
   * 经 URL 解码后拼串)。故 main.ts 建应用时开启了 `rawBody: true`;
   * 若这里拿到的是 `JSON.stringify(body)`, 微信验签会稳定失败。
   *
   * 响应格式由通道决定 (支付宝纯文本 / 微信 JSON), 故用 @Res 直接写,
   * 不经过统一响应信封 —— 渠道不认识 `{code,data,message}`。
   */
  @Post('callback/:channel')
  async callback(
    @Param('channel') channel: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const rawBody = req.rawBody
      ? req.rawBody.toString('utf8')
      : typeof body === 'object' && body !== null
        ? JSON.stringify(body)
        : '';

    const ack = await this.payments.handleCallback(channel, {
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody,
      body: body ?? {},
    });

    res.status(ack.status);
    res.setHeader('Content-Type', ack.contentType);
    res.send(ack.body);
  }
}
