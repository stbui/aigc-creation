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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAlertsController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const alerts_service_1 = require("./alerts.service");
/**
 * 顶栏告警中心。
 *
 * 所有后台角色都需要看到「与自己有关」的告警，所以端点只要求身份，
 * 具体来源在 service 内按角色权限过滤 —— 用单一权限点会逼着前端
 * 为不同角色写不同请求，且新增来源时要再改一次权限矩阵。
 */
let AdminAlertsController = class AdminAlertsController {
    constructor(alerts) {
        this.alerts = alerts;
    }
    list(actor) {
        return this.alerts.list(actor.role);
    }
};
exports.AdminAlertsController = AdminAlertsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.AdminIdentityOnly)(),
    __param(0, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminAlertsController.prototype, "list", null);
exports.AdminAlertsController = AdminAlertsController = __decorate([
    (0, common_1.Controller)('admin/alerts'),
    __metadata("design:paramtypes", [alerts_service_1.AdminAlertsService])
], AdminAlertsController);
//# sourceMappingURL=alerts.controller.js.map