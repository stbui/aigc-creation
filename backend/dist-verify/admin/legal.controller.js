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
exports.AdminLegalController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const permissions_1 = require("./permissions");
const legal_service_1 = require("../legal/legal.service");
class UpsertLegalDto {
}
__decorate([
    (0, class_validator_1.IsIn)(legal_service_1.LEGAL_SLUGS, { message: "未知的法务文档类型" }),
    __metadata("design:type", String)
], UpsertLegalDto.prototype, "slug", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: "请填写版本号" }),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], UpsertLegalDto.prototype, "version", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: "请填写标题" }),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], UpsertLegalDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: "正文不能为空" }),
    __metadata("design:type", String)
], UpsertLegalDto.prototype, "content", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(legal_service_1.LEGAL_STATUSES),
    __metadata("design:type", String)
], UpsertLegalDto.prototype, "status", void 0);
/**
 * 后台法务文档管理。
 *
 * 正文是**用户要举证的文本**，因此改动一律走审计，且已发布版本不可原地覆盖
 * （`LegalService.upsert` 会拒绝）。前端只能「新建版本 → 发布」，
 * 不能「改一下再点发布」—— 后者会让昨天同意过的人拿到一份不同的协议。
 */
let AdminLegalController = class AdminLegalController {
    constructor(legal) {
        this.legal = legal;
    }
    versions(slug) {
        return this.legal.versions(slug);
    }
    upsert(dto, admin) {
        return this.legal.upsert(dto, admin.id);
    }
    publish(slug, version) {
        return this.legal.publish(slug, version);
    }
};
exports.AdminLegalController = AdminLegalController;
__decorate([
    (0, common_1.Get)()
    // 读与写分开: legal.read 授予了运营/财务, 此前所有端点都要求 legal.write,
    // 这个权限点因此悬空 —— 有读权限的角色既进不了菜单也调不通只读接口。
    ,
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.legalRead),
    __param(0, (0, common_1.Query)("slug")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminLegalController.prototype, "versions", null);
__decorate([
    (0, common_1.Put)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.legalWrite),
    (0, admin_decorator_1.AuditAction)("legal.upsert"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UpsertLegalDto, Object]),
    __metadata("design:returntype", void 0)
], AdminLegalController.prototype, "upsert", null);
__decorate([
    (0, common_1.Post)(":slug/:version/publish"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.legalWrite),
    (0, admin_decorator_1.AuditAction)("legal.publish"),
    __param(0, (0, common_1.Param)("slug")),
    __param(1, (0, common_1.Param)("version")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminLegalController.prototype, "publish", null);
exports.AdminLegalController = AdminLegalController = __decorate([
    (0, common_1.Controller)("admin/legal"),
    __metadata("design:paramtypes", [legal_service_1.LegalService])
], AdminLegalController);
//# sourceMappingURL=legal.controller.js.map