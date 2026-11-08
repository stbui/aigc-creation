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
exports.DeleteUserDto = exports.ChangeUserRoleDto = exports.ChangeUserStatusDto = exports.UserListQueryDto = void 0;
const class_validator_1 = require("class-validator");
const permissions_1 = require("../permissions");
const page_query_dto_1 = require("./page-query.dto");
/** 用户列表查询 */
class UserListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.UserListQueryDto = UserListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "keyword", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["user", ...permissions_1.ADMIN_ROLE_CODES], { message: "role 取值非法" }),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "role", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["active", "disabled", "deleted"], { message: "status 取值非法" }),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "to", void 0);
/** 禁用/启用: status 之外还允许填原因 */
class ChangeUserStatusDto {
}
exports.ChangeUserStatusDto = ChangeUserStatusDto;
__decorate([
    (0, class_validator_1.IsIn)(["active", "disabled"], { message: "只能设为正常或禁用" }),
    __metadata("design:type", String)
], ChangeUserStatusDto.prototype, "status", void 0);
/** 角色变更 */
class ChangeUserRoleDto {
}
exports.ChangeUserRoleDto = ChangeUserRoleDto;
__decorate([
    (0, class_validator_1.IsIn)(permissions_1.ADMIN_ROLE_CODES, { message: "只能授予后台角色" }),
    __metadata("design:type", String)
], ChangeUserRoleDto.prototype, "role", void 0);
/** 物理删除 */
class DeleteUserDto {
}
exports.DeleteUserDto = DeleteUserDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DeleteUserDto.prototype, "confirm", void 0);
//# sourceMappingURL=user.dto.js.map