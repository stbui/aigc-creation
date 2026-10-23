import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { contextOf } from './auth.controller';
import { QrLoginService } from './qr-login.service';
import { QrConfirmDto, QrStatusQueryDto, QrTicketDto } from './dto/qr.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { RateLimit, type RateLimitOptions } from '../common/rate-limit.guard';

/*
 * 限流口径 (B2 的 RateLimitGuard):
 *
 *   create   10 / 分钟 / IP —— 每次建码落一行库, 且二维码是凭据类入口, 与登录同档
 *   status  120 / 分钟 / IP —— 1.5s 轮询 = 40 次/分钟, 留三倍余量;
 *                             桌面端多标签页同时登录也不会被自己挡住
 *   scan     30 / 分钟 / 用户 —— 扫码要已登录, 按用户而非 IP 计
 *   confirm  30 / 分钟 / 用户 —— 同上
 *
 * create / status 提供 limitEnv: 自动化测试会在秒级反复建码轮询, 生产配额
 * 会把测试自己挡在门外 (与 login 同一处理)。scan / confirm 按用户计,
 * 天然不会因测试账号数量多而互相挤占。
 */
const RL_QR_CREATE: RateLimitOptions = {
  name: 'auth-qr-create',
  limit: 10,
  windowSec: 60,
  limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_QR_STATUS: RateLimitOptions = {
  name: 'auth-qr-status',
  limit: 120,
  windowSec: 60,
  limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_QR_SCAN: RateLimitOptions = { name: 'auth-qr-scan', scope: 'user', limit: 30, windowSec: 60 };
const RL_QR_CONFIRM: RateLimitOptions = {
  name: 'auth-qr-confirm',
  scope: 'user',
  limit: 30,
  windowSec: 60,
};

/**
 * 扫码登录 (B8)。
 *
 * 两个端点公开 (create / status), 两个需要已登录 (scan / confirm) ——
 * 语义就是「桌面建码 → 手机 (已登录) 确认 → 桌面换取会话」。
 * 状态机与安全约束见 `qr-login.service.ts` 顶部说明。
 */
@Controller('auth/qr')
export class QrLoginController {
  constructor(private readonly qr: QrLoginService) {}

  /** 桌面端建码。返回票据明文 (仅此一次), 由前端渲染成二维码 */
  @RateLimit(RL_QR_CREATE)
  @Post('create')
  create(@Req() req: Request) {
    return this.qr.create(contextOf(req));
  }

  /** 桌面端轮询。confirmed 时本次响应即携带 accessToken, 票据随即作废 */
  @RateLimit(RL_QR_STATUS)
  @Get('status')
  status(@Query() query: QrStatusQueryDto, @Req() req: Request) {
    return this.qr.status(query.ticket, contextOf(req));
  }

  /** 手机端扫码: 只标记已扫描, 不授权 */
  @RateLimit(RL_QR_SCAN)
  @UseGuards(JwtAuthGuard)
  @Post('scan')
  scan(@Body() dto: QrTicketDto) {
    return this.qr.scan(dto.ticket);
  }

  /** 手机端确认/拒绝: 唯一真正绑定账号的一步 */
  @RateLimit(RL_QR_CONFIRM)
  @UseGuards(JwtAuthGuard)
  @Post('confirm')
  confirm(@Body() dto: QrConfirmDto, @CurrentUser() user: AuthUser) {
    // 缺省视为同意: 只传 ticket 的客户端也能完成登录, 显式 false 才是拒绝
    return this.qr.confirm(dto.ticket, user.id, dto.approve !== false);
  }
}
