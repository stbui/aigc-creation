import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type RequestContext } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SmsSendDto } from './dto/sms-send.dto';
import { SmsLoginDto } from './dto/sms-login.dto';
import { RateLimit, type RateLimitOptions } from '../common/rate-limit.guard';

/*
 * 限流配额（按 IP，除注明外）：
 *   register        10 / 分钟 —— 注册本身就是重活（bcrypt），且可被刷号
 *   login           10 / 分钟 —— 暴力破解的正面防线
 *   password/forgot  3 / 小时 —— 每封重置邮件都是真实成本
 *   password/reset   5 / 小时 —— 令牌是一次性的，被刷只浪费 CPU
 *   sms/send        1 / 分钟 + 5 / 天 —— 短信按条计费，双窗口缺一不可
 *   sms/login      10 / 分钟 —— 验证码校验的暴力面
 */
// 注册/登录/短信登录可用 RATE_LIMIT_AUTH_PER_MIN 覆盖：自动化测试会在一分钟内
// 反复建号，生产配额会把测试自己挡住。短信与找回密码不提供该开关。
const RL_REGISTER: RateLimitOptions = { name: 'auth-register', limit: 10, windowSec: 60, limitEnv: 'RATE_LIMIT_AUTH_PER_MIN' };
const RL_LOGIN: RateLimitOptions = { name: 'auth-login', limit: 10, windowSec: 60, limitEnv: 'RATE_LIMIT_AUTH_PER_MIN' };
const RL_FORGOT: RateLimitOptions = { name: 'auth-forgot', limit: 3, windowSec: 3600 };
const RL_RESET: RateLimitOptions = { name: 'auth-reset', limit: 5, windowSec: 3600 };
const RL_SMS_SEND: RateLimitOptions = {
  name: 'auth-sms-send',
  rules: [{ limit: 1, windowSec: 60 }, { limit: 5, windowSec: 86400 }],
};
const RL_SMS_LOGIN: RateLimitOptions = { name: 'auth-sms-login', limit: 10, windowSec: 60, limitEnv: 'RATE_LIMIT_AUTH_PER_MIN' };

/**
 * 请求来源提取。
 *
 * `req.ip` 默认是 socket 地址；本项目**默认不信任** `x-forwarded-for`
 * （见 B5 的 `RATE_LIMIT_TRUST_PROXY` 说明）—— 直接读该头等于让任何人
 * 伪造来源 IP，写进登录审计就是一条假证据。
 */
export function contextOf(req: Request): RequestContext {
  return {
    ip: req.ip,
    ua: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}

// 认证接口 (公开, 无 JWT 守卫): /api/v1/auth/*
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @RateLimit(RL_REGISTER)
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @RateLimit(RL_LOGIN)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, contextOf(req));
  }

  /**
   * 申请密码重置。
   *
   * 响应**恒为成功**（防账号枚举），前端文案必须是
   * 「如果该邮箱已注册，重置邮件已发送」而不是「邮件已发送」。
   */
  @RateLimit(RL_FORGOT)
  @Post('password/forgot')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, contextOf(req));
  }

  @RateLimit(RL_RESET)
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /** 发送短信验证码（用途：登录 / 注册时验证手机号） */
  @RateLimit(RL_SMS_SEND)
  @Post('sms/send')
  async sendSms(@Body() dto: SmsSendDto, @Req() req: Request) {
    return this.authService.sendSmsCode(dto, contextOf(req));
  }

  @RateLimit(RL_SMS_LOGIN)
  @Post('sms/login')
  async smsLogin(@Body() dto: SmsLoginDto, @Req() req: Request) {
    return this.authService.smsLogin(dto, contextOf(req));
  }
}
