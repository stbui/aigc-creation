import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
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
 * 依赖 `EmailService` / `SmsService` 来自全局的 `ChannelsModule`（在
 * AppModule 里注册），本模块不需要 import 它 —— 全局模块只对「在其之后
 * 注册的模块」可见，而 ChannelsModule 排在 AuthModule 之前。
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController, QrLoginController, OAuthController],
  providers: [AuthService, AccountTokenService, QrLoginService, OAuthService, OAuthRegistryService, OAuthStateService],
  exports: [AuthService, AccountTokenService],
})
export class AuthModule {}
