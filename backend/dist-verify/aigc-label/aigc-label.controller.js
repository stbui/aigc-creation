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
exports.AdminAigcLabelController = exports.AigcLabelController = exports.UpdateAigcLabelDto = exports.AigcLabelSpecDto = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const aigc_label_service_1 = require("./aigc-label.service");
const admin_decorator_1 = require("../admin/admin.decorator");
const permissions_1 = require("../admin/permissions");
const aigc_label_config_1 = require("../common/aigc-label.config");
/**
 * 角标样式入参。
 *
 * 范围校验与 `sanitizeAigcLabelSpec` 双重进行：DTO 负责「明显不合法就拒绝」，
 * sanitize 负责「存量 / 绕过前端的值夹紧到合法区间」。两者都要有 ——
 * 只有 sanitize 会让运营把 300 号字存进库、界面却显示 120，分不清哪个是真值。
 */
class AigcLabelSpecDto {
}
exports.AigcLabelSpecDto = AigcLabelSpecDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AigcLabelSpecDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], AigcLabelSpecDto.prototype, "text", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], AigcLabelSpecDto.prototype, "fontFamily", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(12),
    (0, class_validator_1.Max)(120),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "fontSize", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(100),
    (0, class_validator_1.Max)(900),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "fontWeight", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(20),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "letterSpacing", void 0);
__decorate([
    (0, class_validator_1.Matches)(/^#[0-9a-fA-F]{6}$/, { message: "文字颜色必须是 #rrggbb" }),
    __metadata("design:type", String)
], AigcLabelSpecDto.prototype, "textColor", void 0);
__decorate([
    (0, class_validator_1.Matches)(/^#[0-9a-fA-F]{6}$/, { message: "底色必须是 #rrggbb" }),
    __metadata("design:type", String)
], AigcLabelSpecDto.prototype, "backgroundColor", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "backgroundOpacity", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(120),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "radius", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(160),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "paddingX", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^(#[0-9a-fA-F]{6})?$/, { message: "圆点颜色必须是 #rrggbb 或留空" }),
    __metadata("design:type", String)
], AigcLabelSpecDto.prototype, "dotColor", void 0);
__decorate([
    (0, class_validator_1.IsIn)(aigc_label_config_1.AIGC_LABEL_POSITIONS),
    __metadata("design:type", Object)
], AigcLabelSpecDto.prototype, "position", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(4),
    (0, class_validator_1.Max)(60),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "scalePercent", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(16),
    (0, class_validator_1.Max)(2048),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "minWidthPx", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(16),
    (0, class_validator_1.Max)(4096),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "maxWidthPx", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(10),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "marginPercent", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(20),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], AigcLabelSpecDto.prototype, "opacity", void 0);
class UpdateAigcLabelDto {
}
exports.UpdateAigcLabelDto = UpdateAigcLabelDto;
__decorate([
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => AigcLabelSpecDto),
    __metadata("design:type", AigcLabelSpecDto)
], UpdateAigcLabelDto.prototype, "spec", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(800_000),
    __metadata("design:type", String)
], UpdateAigcLabelDto.prototype, "badgePngBase64", void 0);
/**
 * C 端公开的角标展示参数。
 *
 * 只回「播放器角标要画成什么样」的几个字段：图片的角标已烙进像素，
 * 视频没有内嵌能力（无 ffmpeg），只能由前端按同一份文案补显式标识。
 * 位图与几何不需要，也不应该外发。
 */
let AigcLabelController = class AigcLabelController {
    constructor(label) {
        this.label = label;
    }
    publicSpec() {
        return this.label.publicSpec();
    }
};
exports.AigcLabelController = AigcLabelController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AigcLabelController.prototype, "publicSpec", null);
exports.AigcLabelController = AigcLabelController = __decorate([
    (0, common_1.Controller)("aigc-label"),
    __metadata("design:paramtypes", [aigc_label_service_1.AigcLabelService])
], AigcLabelController);
/**
 * 后台「AI 标识」页。
 *
 * 权限沿用 `setting.read` / `setting.write`：这是发给全体用户的合规标识，
 * 与站点设置同一批人授权，不另开权限点（新增权限点意味着角色矩阵再迁一次）。
 */
let AdminAigcLabelController = class AdminAigcLabelController {
    constructor(label) {
        this.label = label;
    }
    read() {
        return this.label.adminView();
    }
    async update(dto, user) {
        await this.label.save({ spec: dto.spec, badgePngBase64: dto.badgePngBase64 }, user.email);
        return this.label.adminView();
    }
};
exports.AdminAigcLabelController = AdminAigcLabelController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminAigcLabelController.prototype, "read", null);
__decorate([
    (0, common_1.Put)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingWrite),
    (0, admin_decorator_1.AuditAction)("aigc.label_update"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UpdateAigcLabelDto, Object]),
    __metadata("design:returntype", Promise)
], AdminAigcLabelController.prototype, "update", null);
exports.AdminAigcLabelController = AdminAigcLabelController = __decorate([
    (0, common_1.Controller)("admin/aigc-label"),
    __metadata("design:paramtypes", [aigc_label_service_1.AigcLabelService])
], AdminAigcLabelController);
//# sourceMappingURL=aigc-label.controller.js.map