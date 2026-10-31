/**
 * 代理中转子系统模块（P6）。
 *
 * 三个入口、两种计费语义：
 *   · 系统渠道中转（`/ai/system/:channelId/*path` 与短路径 `/api/v1/:channelId/*path`）
 *     —— 用服务端凭证、按渠道模型价格扣费；
 *   · 自定义渠道中转（`/ai/custom`）—— 用户自己的地址与密钥，**不计费**；
 *   · 上游模型目录（`/ai/models`）—— 表单选型用的只读接口。
 *
 * 为什么单独成模块而不是并进 `ModelModule`：
 *   · 中转需要 `ChannelSlotService`（任务域）才能与任务共享渠道并发计数，
 *     而 `ModelModule` 不能反向依赖任务模块；
 *   · 三个 `@All` 入口要在 `AppModule` 中**最后**导入，才能让短路径 catch-all
 *     排在全部业务路由之后。
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ModelModule } from '../model.module';
import { ModelTaskModule } from '../tasks/model-task.module';
import { ProxyChannelService } from './proxy-channel.service';
import { ProxyBillingService } from './proxy-billing.service';
import { ProxyCallLogService } from './proxy-call-log.service';
import { SystemProxyService } from './system-proxy.service';
import { CustomRelaySlotService } from './custom-relay-slot.service';
import { CustomRelayService } from './custom-relay.service';
import { ShortProxyController, SystemProxyController } from './system-proxy.controller';
import { CustomRelayController } from './custom-relay.controller';

@Module({
  imports: [PrismaModule, ModelModule, ModelTaskModule],
  controllers: [SystemProxyController, CustomRelayController, ShortProxyController],
  providers: [
    ProxyChannelService,
    ProxyBillingService,
    ProxyCallLogService,
    CustomRelaySlotService,
    SystemProxyService,
    CustomRelayService,
  ],
})
export class ProxyModule {}
