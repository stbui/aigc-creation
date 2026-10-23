/**
 * 外部消息通道模块（邮件 / 短信）。
 *
 * 设为 `@Global()` 的原因与 LoggerModule 相同：通道是**基础设施**，
 * 任何业务模块（认证、会员到期、订单通知）都可能发消息，逐个 import
 * 只会制造样板与循环依赖风险。模块自身只依赖 ConfigService，无业务耦合。
 */
import { Global, Module } from '@nestjs/common';
import { EmailService } from './email/email.service';
import { SmsService } from './sms/sms.service';

@Global()
@Module({
  providers: [EmailService, SmsService],
  exports: [EmailService, SmsService],
})
export class ChannelsModule {}
