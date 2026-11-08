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
exports.AdminUsersController = exports.UserBatchDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
const users_service_1 = require("./users.service");
const permissions_1 = require("./permissions");
const app_exception_1 = require("../common/app.exception");
const csv_response_1 = require("../common/csv-response");
const user_dto_1 = require("./dto/user.dto");
/**
 * 批量启用 / 禁用。
 *
 * 刻意**不提供批量删除**：禁用可逆，删除不可逆，而批量删除是「点错一次
 * 影响 100 个人」的操作。需要清退账号时逐条走删除（有影响面预览与确认词）。
 */
class UserBatchDto {
}
exports.UserBatchDto = UserBatchDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100, { message: "单次批量最多 100 条" }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UserBatchDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["disable", "enable"], { message: "action 只能是 disable 或 enable" }),
    __metadata("design:type", String)
], UserBatchDto.prototype, "action", void 0);
/**
 * 用户与账户管理。
 *
 * 动作命名约定: `<资源>.<动作>` (user.* / account.*), 与 AdminAuditLog.action 对齐。
 * 高危动作 (删除/重置密码) 走 @RequirePermission 的独立权限点,
 * 便于运营单独回收这些权限而不必撤销整个模块。
 */
let AdminUsersController = class AdminUsersController {
    constructor(users, roles) {
        this.users = users;
        this.roles = roles;
    }
    /** 用户列表 */
    list(query) {
        return this.users.list(query);
    }
    /**
     * 导出用户 (CSV)。
     *
     * ⚠️ 必须声明在 `:id` 之前：否则 `/admin/users/export` 会被当成 id 为 export 的用户。
     */
    async export(query, res) {
        const csv = await this.users.exportCsv(query);
        (0, csv_response_1.sendCsv)(res, "users", csv);
    }
    /**
     * 批量启用 / 禁用。
     *
     * 权限按 action 单独判定（`user.disable`）：路由上挂的是 `user.read`
     * 作为入口权限，动作权限在处理器内用 AdminRoleService 显式校验 ——
     * 一个端点承载多个动作时，静态装饰器表达不了「按 action 取权限」，
     * 而把两者都放宽成 user.read 会让只读角色获得禁用能力。
     */
    async batch(dto, actor) {
        if (!(await this.roles.hasPermission(actor.id, permissions_1.PERMISSIONS.userDisable))) {
            throw new app_exception_1.AppError(40301, "没有批量启停账号的权限", 403);
        }
        return this.users.batchStatus(dto.ids, dto.action === "disable" ? "disabled" : "active", actor.id);
    }
    /** 用户详情 */
    detail(id) {
        return this.users.detail(id);
    }
    /**
     * 最近登录记录。
     *
     * 单独成端点而不是塞进 detail 的原因：登录 IP/UA 属于**安全审计数据**，
     * 权限点与用户管理不同（audit.read），只有运营/管理员角色默认持有。
     * 塞进 detail 会让仅有 user.read 的角色顺手看到全站登录 IP。
     */
    logins(id, limit) {
        return this.users.recentLogins(id, Number(limit) || 50);
    }
    /** 删除前的连带影响预览, 供确认弹窗展示具体数量 */
    impact(id) {
        return this.users.impactPreview(id);
    }
    /**
     * 禁用 / 启用账号。
     *
     * 由于 AdminGuard 每次请求查库校验 status, 禁用后该用户的旧 token
     * 下一次请求即 403, 无需额外的 token 黑名单机制。
     */
    changeStatus(id, dto, actor) {
        return this.users.changeStatus(id, dto, actor.id);
    }
    /**
     * 变更角色。
     *
     * 防提权规则在 service 层: 只有 admin 能授予 admin, 且最后一个 admin 不可降级。
     */
    changeRole(id, dto, actor) {
        return this.users.changeRole(id, dto, actor);
    }
    /** 重置密码: 返回一次性临时密码, 明文不入库不入审计 */
    resetPassword(id) {
        return this.users.resetPassword(id);
    }
    /**
     * 删除用户。
     *
     * 默认软删 (status='deleted' + 匿名化); `?hard=true` 物理删除可删部分。
     * **订单不在删除范围内** —— 《电子商务法》要求交易信息保存不少于 3 年。
     */
    remove(id, hard, dto) {
        return this.users.remove(id, hard === "true", dto?.confirm);
    }
    /**
     * 角色下拉选项 (供用户列表筛选用)。
     *
     * 方法名不能叫 `roles` —— 构造函数里注入的 `AdminRoleService` 占了这个名字,
     * 同类内重复声明的成员会让编译直接失败。路由路径不受影响。
     */
    roleOptions() {
        return Object.entries(permissions_1.ROLE_LABELS).map(([code, label]) => ({
            code,
            label,
        }));
    }
};
exports.AdminUsersController = AdminUsersController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_dto_1.UserListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.userRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_dto_1.UserListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "export", null);
__decorate([
    (0, common_1.Post)("batch"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userRead),
    (0, admin_decorator_1.AuditAction)("user.batch"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UserBatchDto, Object]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "batch", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "detail", null);
__decorate([
    (0, common_1.Get)(":id/logins"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.auditRead),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "logins", null);
__decorate([
    (0, common_1.Get)(":id/impact"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "impact", null);
__decorate([
    (0, common_1.Patch)(":id/status"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userDisable),
    (0, admin_decorator_1.AuditAction)("user.status_change"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, user_dto_1.ChangeUserStatusDto, Object]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "changeStatus", null);
__decorate([
    (0, common_1.Patch)(":id/role"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userWrite),
    (0, admin_decorator_1.AuditAction)("user.role_change"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, user_dto_1.ChangeUserRoleDto, Object]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "changeRole", null);
__decorate([
    (0, common_1.Post)(":id/password"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userResetPassword),
    (0, admin_decorator_1.AuditAction)("user.password_reset"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userDelete),
    (0, admin_decorator_1.AuditAction)("user.delete"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("hard")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, user_dto_1.DeleteUserDto]),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)("meta/roles"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.userRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminUsersController.prototype, "roleOptions", null);
exports.AdminUsersController = AdminUsersController = __decorate([
    (0, common_1.Controller)("admin/users"),
    __metadata("design:paramtypes", [users_service_1.AdminUsersService,
        admin_role_service_1.AdminRoleService])
], AdminUsersController);
//# sourceMappingURL=users.controller.js.map