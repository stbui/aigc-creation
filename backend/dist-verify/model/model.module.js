"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ModelBootstrapService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelModule = exports.ModelBootstrapService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("../prisma/prisma.module");
const secret_cipher_1 = require("./infra/secret-cipher");
const outbound_1 = require("./infra/outbound");
const catalog_version_service_1 = require("./infra/catalog-version.service");
const registry_1 = require("./protocol/registry");
const protocol_catalog_service_1 = require("./protocol/protocol-catalog.service");
const plugin_protocols_service_1 = require("./protocol/plugin-protocols.service");
const executor_1 = require("./protocol/executor");
const protocol_test_service_1 = require("./protocol/protocol-test.service");
const model_catalog_client_1 = require("./catalog/model-catalog.client");
const model_catalog_service_1 = require("./catalog/model-catalog.service");
const plugin_manifest_store_1 = require("./plugins/plugin-manifest.store");
const channel_health_service_1 = require("./channels/channel-health.service");
const channel_model_metrics_service_1 = require("./channels/channel-model-metrics.service");
const channel_service_1 = require("./channels/channel.service");
const channel_model_service_1 = require("./channels/channel-model.service");
const channel_runtime_service_1 = require("./channels/channel-runtime.service");
const text_tool_service_1 = require("./text/text-tool.service");
const channel_controller_1 = require("./channels/channel.controller");
const public_channels_controller_1 = require("./channels/public-channels.controller");
const route_catalog_service_1 = require("./catalog/route-catalog.service");
const catalog_service_1 = require("./catalog/catalog.service");
const quote_service_1 = require("./catalog/quote.service");
const models_controller_1 = require("./catalog/models.controller");
const model_catalog_controller_1 = require("./catalog/model-catalog.controller");
const public_model_catalog_service_1 = require("./catalog/public-model-catalog.service");
const admin_logical_model_controller_1 = require("./catalog/admin-logical-model.controller");
const logical_model_admin_service_1 = require("./catalog/logical-model.admin.service");
const route_health_service_1 = require("./routing/route-health.service");
const price_tier_service_1 = require("./routing/price-tier.service");
const router_service_1 = require("./routing/router.service");
const user_group_service_1 = require("./user-groups/user-group.service");
const user_group_admin_service_1 = require("./user-groups/user-group.admin.service");
const user_group_controller_1 = require("./user-groups/user-group.controller");
const plugin_admin_service_1 = require("./plugins/plugin.admin.service");
const plugin_controller_1 = require("./plugins/plugin.controller");
const provider_catalog_controller_1 = require("./plugins/provider-catalog.controller");
const provider_catalog_service_1 = require("./plugins/provider-catalog.service");
const credit_wallet_service_1 = require("./billing/credit-wallet.service");
const billing_service_1 = require("./billing/billing.service");
const billing_admin_service_1 = require("./billing/billing-admin.service");
const billing_admin_controller_1 = require("./billing/billing-admin.controller");
const analytics_controller_1 = require("./billing/analytics.controller");
const finance_analytics_service_1 = require("./billing/finance-analytics.service");
const billing_sweeper_service_1 = require("./billing/billing-sweeper.service");
/** 启动期把配置层策略注入出站模块（避免两处各读一次环境变量） */
let ModelBootstrapService = ModelBootstrapService_1 = class ModelBootstrapService {
    constructor(config, groups) {
        this.config = config;
        this.groups = groups;
        this.log = new common_1.Logger(ModelBootstrapService_1.name);
    }
    async onModuleInit() {
        (0, outbound_1.configureOutboundPolicy)({
            allowPrivateUpstreams: this.config.get('model.allowPrivateUpstreams') ?? false,
            allowedPrivateUpstreamHosts: this.config.get('model.allowedPrivateUpstreamHosts') ?? [],
        });
        if (!String(this.config.get('model.secretKey') ?? '').trim()) {
            this.log.warn('未配置 MODEL_SECRET_KEY：渠道凭证将使用本地文件密钥加密，生产环境必须显式配置');
        }
        try {
            // 默认分组是计费基线；缺失时 `resolvedGroup` 也会即时补齐，这里只是把
            // 「新库首个请求才发现缺分组」的窗口提前到启动期
            await this.groups.ensureDefaultGroup();
        }
        catch (error) {
            this.log.warn(`默认用户分组补齐失败，将在首次请求时重试：${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
exports.ModelBootstrapService = ModelBootstrapService;
exports.ModelBootstrapService = ModelBootstrapService = ModelBootstrapService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        user_group_service_1.UserGroupService])
], ModelBootstrapService);
let ModelModule = class ModelModule {
};
exports.ModelModule = ModelModule;
exports.ModelModule = ModelModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [
            channel_controller_1.AdminChannelsController,
            channel_controller_1.AdminChannelModelsController,
            public_channels_controller_1.PublicChannelsController,
            admin_logical_model_controller_1.AdminLogicalModelsController,
            user_group_controller_1.AdminUserGroupsController,
            plugin_controller_1.AdminPluginsController,
            provider_catalog_controller_1.AdminProviderCatalogController,
            billing_admin_controller_1.AdminBillingOrdersController,
            billing_admin_controller_1.AdminApiLogsController,
            analytics_controller_1.AdminAnalyticsController,
            models_controller_1.ModelsController,
            model_catalog_controller_1.ModelCatalogController,
        ],
        providers: [
            ModelBootstrapService,
            secret_cipher_1.SecretCipher,
            registry_1.ProtocolRegistry,
            plugin_manifest_store_1.PluginManifestStore,
            plugin_protocols_service_1.PluginProtocolService,
            executor_1.ProtocolExecutor,
            protocol_test_service_1.ProtocolTestService,
            model_catalog_client_1.ModelCatalogClient,
            model_catalog_service_1.ModelCatalogService,
            protocol_catalog_service_1.ProtocolCatalogService,
            catalog_version_service_1.CatalogVersionService,
            channel_model_service_1.ChannelModelService,
            channel_runtime_service_1.ChannelRuntimeService,
            text_tool_service_1.TextToolService,
            channel_service_1.ChannelService,
            channel_health_service_1.ChannelHealthService,
            channel_model_metrics_service_1.ChannelModelMetricsService,
            user_group_service_1.UserGroupService,
            user_group_admin_service_1.UserGroupAdminService,
            plugin_admin_service_1.PluginAdminService,
            provider_catalog_service_1.ProviderCatalogService,
            route_catalog_service_1.RouteCatalogService,
            route_health_service_1.RouteHealthService,
            price_tier_service_1.PriceTierService,
            router_service_1.RouterService,
            catalog_service_1.CatalogService,
            public_model_catalog_service_1.PublicModelCatalogService,
            logical_model_admin_service_1.LogicalModelAdminService,
            quote_service_1.QuoteService,
            credit_wallet_service_1.CreditWalletService,
            billing_service_1.BillingService,
            billing_admin_service_1.BillingAdminService,
            finance_analytics_service_1.FinanceAnalyticsService,
            billing_sweeper_service_1.BillingSweeperService,
        ],
        exports: [
            secret_cipher_1.SecretCipher,
            registry_1.ProtocolRegistry,
            plugin_manifest_store_1.PluginManifestStore,
            plugin_protocols_service_1.PluginProtocolService,
            executor_1.ProtocolExecutor,
            protocol_test_service_1.ProtocolTestService,
            model_catalog_client_1.ModelCatalogClient,
            model_catalog_service_1.ModelCatalogService,
            protocol_catalog_service_1.ProtocolCatalogService,
            catalog_version_service_1.CatalogVersionService,
            channel_model_service_1.ChannelModelService,
            channel_runtime_service_1.ChannelRuntimeService,
            text_tool_service_1.TextToolService,
            channel_service_1.ChannelService,
            channel_health_service_1.ChannelHealthService,
            user_group_service_1.UserGroupService,
            route_catalog_service_1.RouteCatalogService,
            route_health_service_1.RouteHealthService,
            price_tier_service_1.PriceTierService,
            router_service_1.RouterService,
            catalog_service_1.CatalogService,
            quote_service_1.QuoteService,
            credit_wallet_service_1.CreditWalletService,
            billing_service_1.BillingService,
        ],
    })
], ModelModule);
//# sourceMappingURL=model.module.js.map