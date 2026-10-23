import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OAuthService } from './oauth.service';
import { OAuthAuthorizeQueryDto, OAuthCompleteDto } from './oauth.dto';
import { contextOf } from '../auth.controller';
import { RateLimit, type RateLimitOptions } from '../../common/rate-limit.guard';

const RL_OAUTH_AUTHORIZE: RateLimitOptions = {
  name: 'auth-oauth-authorize',
  limit: 20,
  windowSec: 60,
  limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_OAUTH_CALLBACK: RateLimitOptions = {
  name: 'auth-oauth-callback',
  limit: 30,
  windowSec: 60,
  limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_OAUTH_COMPLETE: RateLimitOptions = {
  name: 'auth-oauth-complete',
  limit: 30,
  windowSec: 60,
  limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};

/**
 * 通用 OAuth 登录入口。
 *
 * 浏览器跳转类端点不能返回统一 JSON 信封：它们在 provider 重定向后
 * 直接回到浏览器地址栏，错误必须也以 302 带回前端完成页，否则用户看到
 * 的是裸 JSON。
 */
@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /** 前端「第三方登录」按钮只渲染这里列出的 provider */
  @Get('providers')
  providers() {
    return this.oauth.providers();
  }

  @RateLimit(RL_OAUTH_AUTHORIZE)
  @Get(':provider/authorize')
  async authorize(
    @Param('provider') provider: string,
    @Query() query: OAuthAuthorizeQueryDto,
    @Res() res: Response,
  ) {
    try {
      const url = await this.oauth.authorizeUrl(provider, query.returnTo);
      return res.redirect(302, url);
    } catch (err) {
      return this.redirectError(res, (err as Error).message);
    }
  }

  @RateLimit(RL_OAUTH_CALLBACK)
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    if (error) {
      return this.redirectError(res, errorDescription || `第三方登录已取消 (${error})`);
    }
    try {
      const result = await this.oauth.handleCallback(provider, code, state);
      const params = new URLSearchParams({
        ticket: result.ticket,
        provider: result.provider,
        ...(result.returnTo ? { returnTo: result.returnTo } : {}),
      });
      return res.redirect(302, `${this.webBase()}/auth/oauth/callback?${params.toString()}`);
    } catch (err) {
      return this.redirectError(res, (err as Error).message);
    }
  }

  @RateLimit(RL_OAUTH_COMPLETE)
  @Post('complete')
  complete(@Body() dto: OAuthCompleteDto, @Req() req: Request) {
    return this.oauth.complete(dto.ticket, contextOf(req));
  }

  private redirectError(res: Response, message: string) {
    return res.redirect(302, `${this.webBase()}/auth/oauth/callback?error=${encodeURIComponent(message)}`);
  }

  private webBase(): string {
    return (process.env.WEB_BASE_URL || 'http://localhost:5100').replace(/\/+$/, '');
  }
}
