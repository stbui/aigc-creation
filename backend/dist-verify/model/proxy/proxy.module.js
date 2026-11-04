"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const model_module_1 = require("../model.module");
const model_task_module_1 = require("../tasks/model-task.module");
const proxy_channel_service_1 = require("./proxy-channel.service");
const proxy_billing_service_1 = require("./proxy-billing.service");
const proxy_call_log_service_1 = require("./proxy-call-log.service");
const system_proxy_service_1 = require("./system-proxy.service");
const custom_relay_slot_service_1 = require("./custom-relay-slot.service");
const custom_relay_service_1 = require("./custom-relay.service");
const system_proxy_controller_1 = require("./system-proxy.controller");
const custom_relay_controller_1 = require("./custom-relay.controller");
let ProxyModule = class ProxyModule {
};
exports.ProxyModule = ProxyModule;
exports.ProxyModule = ProxyModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, model_module_1.ModelModule, model_task_module_1.ModelTaskModule],
        controllers: [system_proxy_controller_1.SystemProxyController, custom_relay_controller_1.CustomRelayController, system_proxy_controller_1.ShortProxyController],
        providers: [
            proxy_channel_service_1.ProxyChannelService,
            proxy_billing_service_1.ProxyBillingService,
            proxy_call_log_service_1.ProxyCallLogService,
            custom_relay_slot_service_1.CustomRelaySlotService,
            system_proxy_service_1.SystemProxyService,
            custom_relay_service_1.CustomRelayService,
        ],
    })
], ProxyModule);
//# sourceMappingURL=proxy.module.js.map