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
exports.AdminCapabilitiesController = exports.CapabilityToggleDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const permissions_1 = require("./permissions");
const capability_availability_service_1 = require("../capabilities/capability-availability.service");
/** 上下线入参。下架时 reason 必填（service 侧校验，这里只限长度） */
class CapabilityToggleDto {
}
exports.CapabilityToggleDto = CapabilityToggleDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CapabilityToggleDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CapabilityToggleDto.prototype, "reason", void 0);
/**
 * 能力上下线（后台「能力管控」页）。
 *
 * 为什么需要这个开关
 * ---------------
 * 某项能力依赖的厂商通道挂了、或产出质量被投诉，运营需要**立刻停止收单**，
 * 而不是等下一次发版。没有这个开关时唯一手段是下掉整条模型线路 ——
 * 那会连带影响所有能力，把局部故障放大成全站故障。
 *
 * 权限与审计：读 `capability.read`、写 `capability.write`（属高危集合，
 * AuditInterceptor 要求填写原因）。下架原因同时展示给 C 端用户 ——
 * 只说「已下线」会让用户去问客服，写清原因才是可自助的。
 */
let AdminCapabilitiesController = class AdminCapabilitiesController {
    constructor(availability) {
        this.availability = availability;
    }
    list() {
        return this.availability.adminList();
    }
    /**
     * 上线 / 下线。
     *
     * 用 PUT 而非 PATCH：这个端点的语义是「把这项能力置于某状态」（幂等），
     * 重复调用结果一致，符合 PUT 的契约。
     */
    async set(id, dto, user) {
        const row = await this.availability.setEnabled(id, dto.enabled, dto.reason, user.email);
        return { capabilityId: row.capabilityId, enabled: row.enabled, reason: row.reason };
    }
};
exports.AdminCapabilitiesController = AdminCapabilitiesController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.capabilityRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminCapabilitiesController.prototype, "list", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.capabilityWrite),
    (0, admin_decorator_1.AuditAction)('capability.toggle'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, CapabilityToggleDto, Object]),
    __metadata("design:returntype", Promise)
], AdminCapabilitiesController.prototype, "set", null);
exports.AdminCapabilitiesController = AdminCapabilitiesController = __decorate([
    (0, common_1.Controller)('admin/capabilities'),
    __metadata("design:paramtypes", [capability_availability_service_1.CapabilityAvailabilityService])
], AdminCapabilitiesController);
//# sourceMappingURL=capability.controller.js.map