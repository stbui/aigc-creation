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
exports.RoleListQueryDto = exports.UpdateRolePermissionsDto = exports.RolePermissionUpdateDto = exports.AuditListQueryDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const page_query_dto_1 = require("./page-query.dto");
const permissions_1 = require("../permissions");
/** 审计日志查询 */
class AuditListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.AuditListQueryDto = AuditListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AuditListQueryDto.prototype, "actorId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], AuditListQueryDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], AuditListQueryDto.prototype, "targetId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (value === undefined)
            return undefined;
        if (value === "true")
            return true;
        if (value === "false")
            return false;
        return value;
    }),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AuditListQueryDto.prototype, "success", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AuditListQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AuditListQueryDto.prototype, "to", void 0);
/** 单个角色的权限全集 */
class RolePermissionUpdateDto {
}
exports.RolePermissionUpdateDto = RolePermissionUpdateDto;
__decorate([
    (0, class_validator_1.IsIn)(permissions_1.ADMIN_ROLE_CODES, { message: "角色 code 非法" }),
    __metadata("design:type", String)
], RolePermissionUpdateDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayUnique)({ message: "权限点不能重复" }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], RolePermissionUpdateDto.prototype, "permissions", void 0);
/**
 * 批量更新角色权限。
 *
 * 一次页面保存可能同时改动多个角色，必须在一个事务里提交；逐角色发请求会
 * 产生「前一个角色已生效、后一个失败」的半保存状态。
 */
class UpdateRolePermissionsDto {
}
exports.UpdateRolePermissionsDto = UpdateRolePermissionsDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(permissions_1.ADMIN_ROLE_CODES.length),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => RolePermissionUpdateDto),
    __metadata("design:type", Array)
], UpdateRolePermissionsDto.prototype, "roles", void 0);
/** 角色查询 */
class RoleListQueryDto {
}
exports.RoleListQueryDto = RoleListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["admin", "operator", "finance"]),
    __metadata("design:type", String)
], RoleListQueryDto.prototype, "code", void 0);
//# sourceMappingURL=audit.dto.js.map