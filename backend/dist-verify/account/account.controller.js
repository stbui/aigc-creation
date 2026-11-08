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
exports.AccountController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const account_service_1 = require("./account.service");
const account_lifecycle_service_1 = require("./account-lifecycle.service");
const account_dto_1 = require("./dto/account.dto");
/**
 * 账户自助。
 *
 * 路径用 `/me` 而不是 `/users/:id`：后者的 :id 一旦漏校验就是越权，
 * 而 `/me` 在路由层面就没有"别人的账号"这个概念。
 */
let AccountController = class AccountController {
    constructor(account, lifecycle) {
        this.account = account;
        this.lifecycle = lifecycle;
    }
    async profile(user) {
        return this.account.profile(user.id);
    }
    async update(user, dto) {
        return this.account.updateProfile(user.id, dto);
    }
    /** 改密成功后旧 token 全部失效（含当前这把），前端需跳登录 */
    async changePassword(user, dto) {
        return this.account.changePassword(user.id, dto.oldPassword, dto.newPassword);
    }
    /** 个人信息导出（JSON，同步返回） */
    async export(user) {
        return this.account.export(user.id);
    }
    /** 注销前影响面预览 */
    async deletionPreview(user) {
        return this.lifecycle.impact(user.id);
    }
    /** 自助注销（密码 + 确认词「注销」） */
    async remove(user, dto) {
        return this.account.deleteAccount(user.id, dto.password, dto.confirm);
    }
};
exports.AccountController = AccountController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "profile", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, account_dto_1.UpdateProfileDto]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('password'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, account_dto_1.ChangePasswordDto]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "changePassword", null);
__decorate([
    (0, common_1.Post)('export'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "export", null);
__decorate([
    (0, common_1.Get)('deletion-preview'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "deletionPreview", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, account_dto_1.DeleteAccountDto]),
    __metadata("design:returntype", Promise)
], AccountController.prototype, "remove", null);
exports.AccountController = AccountController = __decorate([
    (0, common_1.Controller)('me'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [account_service_1.AccountService,
        account_lifecycle_service_1.AccountLifecycleService])
], AccountController);
//# sourceMappingURL=account.controller.js.map