"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilitiesController = void 0;
const common_1 = require("@nestjs/common");
const capability_registry_1 = require("./capability.registry");
const credit_price_service_1 = require("../credits/credit-price.service");
const capability_availability_service_1 = require("./capability-availability.service");
/**
 * 能力清单下发接口 (公开, 免登录)。
 *
 * 前端不硬编码任何能力清单 —— 卡片、侧栏、表单全部由这里的数据渲染,
 * 新增/下线能力只改 registry 一处。
 */
let CapabilitiesController = class CapabilitiesController {
    constructor(price, availability) {
        this.price = price;
        this.availability = availability;
    }
    /**
     * ⚠ `creditCost` 在此**覆盖**为运行时生效价 (SystemSetting > registry),
     * 而不是直接透传 registry 字段 —— 前端要显示的是「用户现在实际会被扣多少」,
     * 不是「代码里写的默认值是多少」。后台改价后无需改前端即可生效。
     */
    async list() {
        const [prices, runtime] = await Promise.all([this.price.resolveAll(), this.availability.runtimeAll()]);
        return {
            groups: capability_registry_1.CAPABILITY_GROUPS,
            // 顺序即侧栏与工作台的展示顺序
            items: capability_registry_1.CAPABILITIES.map((c) => ({
                ...c,
                creditCost: prices[c.id] ?? c.creditCost ?? 0,
                defaultParams: (0, capability_registry_1.defaultParamsFor)(c.id),
                /*
                 * 运行时真相：这一项**此刻**按下去会发生什么。
                 *
                 * 与 `mode` 正交且**不改 mode 的形状** —— 前端既有逻辑（已接入 / 规划中）
                 * 全部基于 mode，动它会牵一发动全身；runtime 是增量字段，
                 * 新界面用它，老界面不受影响。
                 */
                runtime: runtime[c.id],
            })),
            workbenchIds: capability_registry_1.WORKBENCH_CAPABILITIES.map((c) => c.id),
        };
    }
};
exports.CapabilitiesController = CapabilitiesController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CapabilitiesController.prototype, "list", null);
exports.CapabilitiesController = CapabilitiesController = __decorate([
    (0, common_1.Controller)('capabilities'),
    __metadata("design:paramtypes", [credit_price_service_1.CreditPriceService,
        capability_availability_service_1.CapabilityAvailabilityService])
], CapabilitiesController);
//# sourceMappingURL=capabilities.controller.js.map