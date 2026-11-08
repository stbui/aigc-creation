"use strict";
/**
 * 后台用户分组接口（`/api/v1/admin/user-groups`）。
 *
 *   · `GET    /admin/user-groups`       列表（含用户数与默认分组标记）
 *   · `GET    /admin/user-groups/:id`   详情
 *   · `POST   /admin/user-groups`       新建
 *   · `PATCH  /admin/user-groups/:id`   保存
 *   · `DELETE /admin/user-groups/:id`   删除
 *
 * 语义校验（编码规则、倍率区间、渠道归属、套餐占用）在 `UserGroupAdminService`；
 * 这里只做形状校验与权限 / 审计声明。`code` 创建后不可改 —— 会员套餐按编码映射分组，
 * 改编码等于把存量会员整体换组。
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminUserGroupsController = exports.UserGroupWriteBodyDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("../../admin/admin.decorator");
const permissions_1 = require("../../admin/permissions");
const user_group_admin_service_1 = require("./user-group.admin.service");
/** 分组写入入参（嵌套覆盖项整体透传，语义校验在 service） */
class UserGroupWriteBodyDto {
}
exports.UserGroupWriteBodyDto = UserGroupWriteBodyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserGroupWriteBodyDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserGroupWriteBodyDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserGroupWriteBodyDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserGroupWriteBodyDto.prototype, "badgeLabel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserGroupWriteBodyDto.prototype, "badgeStyle", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(999_999),
    __metadata("design:type", Number)
], UserGroupWriteBodyDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(1_000_000),
    __metadata("design:type", Number)
], UserGroupWriteBodyDto.prototype, "ratioBasisPoints", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], UserGroupWriteBodyDto.prototype, "pointsPerUsdMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], UserGroupWriteBodyDto.prototype, "pointsPerCnyMicrocredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UserGroupWriteBodyDto.prototype, "allChannels", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UserGroupWriteBodyDto.prototype, "channelIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Array)
], UserGroupWriteBodyDto.prototype, "modelOverrides", void 0);
let AdminUserGroupsController = class AdminUserGroupsController {
    constructor(groups) {
        this.groups = groups;
    }
    list() {
        return this.groups.list();
    }
    get(id) {
        return this.groups.get(id);
    }
    create(body) {
        return this.groups.create(body);
    }
    update(id, body) {
        return this.groups.update(id, body);
    }
    async remove(id) {
        await this.groups.remove(id);
        return { ok: true };
    }
};
exports.AdminUserGroupsController = AdminUserGroupsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userGroupRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminUserGroupsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userGroupRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminUserGroupsController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userGroupWrite),
    (0, admin_decorator_1.AuditAction)("user_group.create"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UserGroupWriteBodyDto]),
    __metadata("design:returntype", void 0)
], AdminUserGroupsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userGroupWrite),
    (0, admin_decorator_1.AuditAction)("user_group.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UserGroupWriteBodyDto]),
    __metadata("design:returntype", void 0)
], AdminUserGroupsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userGroupWrite),
    (0, admin_decorator_1.AuditAction)("user_group.delete"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminUserGroupsController.prototype, "remove", null);
exports.AdminUserGroupsController = AdminUserGroupsController = __decorate([
    (0, common_1.Controller)("admin/user-groups"),
    __metadata("design:paramtypes", [user_group_admin_service_1.UserGroupAdminService])
], AdminUserGroupsController);
//# sourceMappingURL=user-group.controller.js.map