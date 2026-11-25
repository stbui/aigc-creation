import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountTokenService } from './account-token.service';
import { QrLoginController } from './qr-login.controller';
import { QrLoginService } from './qr-login.service';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { OAuthRegistryService } from './oauth/oauth.registry';
import { OAuthStateService } from './oauth/oauth-state.service';

/**
 * 认证模块。
 *
 * 依赖 `EmailService` / `SmsService`，由全局模块 `ChannelsModule` 提供（在
 * AppModule 里注册一次）。全局模块在模块图解析后对全站可见，与 imports 中的
 * 相对位置无关，本模块不需要 import 它。
 */
@Module({
  controllers: [AuthController, QrLoginController, OAuthController],
  providers: [AuthService, AccountTokenService, QrLoginService, OAuthService, OAuthRegistryService, OAuthStateService],
  exports: [AuthService, AccountTokenService],
})
export class AuthModule {}
