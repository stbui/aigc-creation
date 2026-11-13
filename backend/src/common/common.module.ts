import { Global, Module } from '@nestjs/common';
import { SignedUrlService } from './signed-url.service';
import { SettingsService } from './settings.service';
import { SettingImageService } from './setting-image.service';
import { SecretCipher } from '../model/infra/secret-cipher';
import { SettingsController } from './settings.controller';

/**
 * 横切关注点模块（B5）。
 *
 * `@Global()`：素材、任务、统计、后台素材都要给自己的 URL 加签名，
 * 逐个 imports 只会制造样板，且容易出现某个模块漏导入 → 那一路返回的
 * `signedUrl` 恒为 null，表现为「列表里一部分图 403、一部分正常」。
 *
 * 限流守卫**不在这里**：它作为 APP_GUARD 在 AppModule 注册（全局守卫按
 * 元数据触发，没标注 @RateLimit 的路由完全不受影响）。
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SignedUrlService, SettingsService, SettingImageService, SecretCipher],
  exports: [SignedUrlService, SettingsService, SettingImageService, SecretCipher],
})
export class CommonModule {}
