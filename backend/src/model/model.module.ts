/**
 * 渠道与模型子系统模块（移植自 open-ai-canvas）。
 *
 * 已装配：
 *   · P2 —— 密钥加密、出站策略、协议注册表与插件适配器、请求执行器、协议目录、
 *     目录版本、渠道 / 渠道模型数据层与后台接口、连通性测试；
 *   · P3 —— 路由目录快照、意图匹配、用户分组、选路与冷却、报价，以及
 *     前台 `/models*` 与后台路由模拟接口；
 *   · P4 —— 微积分钱包（账户 + 批次）与生成账单（预留 / 结算 / 退款 / 人工核对）；
 *   · P5 —— 后台六页（渠道 / 前台模型 / 用户分组 / 插件 / 生成账单 / 调用记录）
 *     与公开 `/model-catalog*`（供应视角目录，`models` 恒空、模型在 `channels[].models`）；
 *   · P6 —— 代理中转（系统 / 自定义 / 短链）、插件安装、财务分析，并删除旧
 *     `src/providers/**`、`GATEWAY_*`、`ModelCallLog` 与 `/admin/model-config`。
 */

import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { SecretCipher } from './infra/secret-cipher';
import { configureOutboundPolicy } from './infra/outbound';
import { CatalogVersionService } from './infra/catalog-version.service';
import { ProtocolRegistry } from './protocol/registry';
import { ProtocolCatalogService } from './protocol/protocol-catalog.service';
import { PluginProtocolService } from './protocol/plugin-protocols.service';
import { ProtocolExecutor } from './protocol/executor';
import { ProtocolTestService } from './protocol/protocol-test.service';
import { ModelCatalogClient } from './catalog/model-catalog.client';
import { ModelCatalogService } from './catalog/model-catalog.service';
import { PluginManifestStore } from './plugins/plugin-manifest.store';
import { ChannelHealthService } from './channels/channel-health.service';
import { ChannelService } from './channels/channel.service';
import { ChannelModelService } from './channels/channel-model.service';
import { ChannelRuntimeService } from './channels/channel-runtime.service';
import { TextToolService } from './text/text-tool.service';
import { AdminChannelModelsController, AdminChannelsController } from './channels/channel.controller';
import { RouteCatalogService } from './catalog/route-catalog.service';
import { CatalogService } from './catalog/catalog.service';
import { QuoteService } from './catalog/quote.service';
import { ModelsController } from './catalog/models.controller';
import { ModelCatalogController } from './catalog/model-catalog.controller';
import { PublicModelCatalogService } from './catalog/public-model-catalog.service';
import { AdminLogicalModelsController } from './catalog/admin-logical-model.controller';
import { LogicalModelAdminService } from './catalog/logical-model.admin.service';
import { RouteHealthService } from './routing/route-health.service';
import { PriceTierService } from './routing/price-tier.service';
import { RouterService } from './routing/router.service';
import { UserGroupService } from './user-groups/user-group.service';
import { UserGroupAdminService } from './user-groups/user-group.admin.service';
import { AdminUserGroupsController } from './user-groups/user-group.controller';
import { PluginAdminService } from './plugins/plugin.admin.service';
import { AdminPluginsController } from './plugins/plugin.controller';
import { AdminProviderCatalogController } from './plugins/provider-catalog.controller';
import { ProviderCatalogService } from './plugins/provider-catalog.service';
import { CreditWalletService } from './billing/credit-wallet.service';
import { BillingService } from './billing/billing.service';
import { BillingAdminService } from './billing/billing-admin.service';
import { AdminApiLogsController, AdminBillingOrdersController } from './billing/billing-admin.controller';
import { AdminAnalyticsController } from './billing/analytics.controller';
import { FinanceAnalyticsService } from './billing/finance-analytics.service';
import { BillingSweeperService } from './billing/billing-sweeper.service';

/** 启动期把配置层策略注入出站模块（避免两处各读一次环境变量） */
@Injectable()
export class ModelBootstrapService implements OnModuleInit {
  private readonly log = new Logger(ModelBootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly groups: UserGroupService,
  ) {}

  async onModuleInit(): Promise<void> {
    configureOutboundPolicy({
      allowPrivateUpstreams: this.config.get<boolean>('model.allowPrivateUpstreams') ?? false,
      allowedPrivateUpstreamHosts: this.config.get<string[]>('model.allowedPrivateUpstreamHosts') ?? [],
    });
    if (!String(this.config.get<string>('model.secretKey') ?? '').trim()) {
      this.log.warn('未配置 MODEL_SECRET_KEY：渠道凭证将使用本地文件密钥加密，生产环境必须显式配置');
    }
    try {
      // 默认分组是计费基线；缺失时 `resolvedGroup` 也会即时补齐，这里只是把
      // 「新库首个请求才发现缺分组」的窗口提前到启动期
      await this.groups.ensureDefaultGroup();
    } catch (error) {
      this.log.warn(`默认用户分组补齐失败，将在首次请求时重试：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminChannelsController,
    AdminChannelModelsController,
    AdminLogicalModelsController,
    AdminUserGroupsController,
    AdminPluginsController,
    AdminProviderCatalogController,
    AdminBillingOrdersController,
    AdminApiLogsController,
    AdminAnalyticsController,
    ModelsController,
    ModelCatalogController,
  ],
  providers: [
    ModelBootstrapService,
    SecretCipher,
    ProtocolRegistry,
    PluginManifestStore,
    PluginProtocolService,
    ProtocolExecutor,
    ProtocolTestService,
    ModelCatalogClient,
    ModelCatalogService,
    ProtocolCatalogService,
    CatalogVersionService,
    ChannelModelService,
    ChannelRuntimeService,
    TextToolService,
    ChannelService,
    ChannelHealthService,
    UserGroupService,
    UserGroupAdminService,
    PluginAdminService,
    ProviderCatalogService,
    RouteCatalogService,
    RouteHealthService,
    PriceTierService,
    RouterService,
    CatalogService,
    PublicModelCatalogService,
    LogicalModelAdminService,
    QuoteService,
    CreditWalletService,
    BillingService,
    BillingAdminService,
    FinanceAnalyticsService,
    BillingSweeperService,
  ],
  exports: [
    SecretCipher,
    ProtocolRegistry,
    PluginManifestStore,
    PluginProtocolService,
    ProtocolExecutor,
    ProtocolTestService,
    ModelCatalogClient,
    ModelCatalogService,
    ProtocolCatalogService,
    CatalogVersionService,
    ChannelModelService,
    ChannelRuntimeService,
    TextToolService,
    ChannelService,
    ChannelHealthService,
    UserGroupService,
    RouteCatalogService,
    RouteHealthService,
    PriceTierService,
    RouterService,
    CatalogService,
    QuoteService,
    CreditWalletService,
    BillingService,
  ],
})
export class ModelModule {}
