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
exports.AdminMembershipPlansController = exports.AdminMembershipPlansService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const admin_decorator_1 = require("./admin.decorator");
const permissions_1 = require("./permissions");
const membership_service_1 = require("../membership/membership.service");
/** 权益入参。与 C 端 `parsePerks` 的字段一致，避免后台写进 C 端读不懂的 JSON */
class PlanPerksDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PlanPerksDto.prototype, "fastChannel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], PlanPerksDto.prototype, "maxConcurrent", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(10000),
    __metadata("design:type", Number)
], PlanPerksDto.prototype, "addonDiscountBps", void 0);
class CreateMembershipPlanDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[a-z0-9][a-z0-9_-]{1,39}$/, {
        message: "编码只能是小写字母/数字/下划线/短横线，长度 2~40",
    }),
    __metadata("design:type", String)
], CreateMembershipPlanDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CreateMembershipPlanDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], CreateMembershipPlanDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateMembershipPlanDto.prototype, "priceCents", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(3650),
    __metadata("design:type", Number)
], CreateMembershipPlanDto.prototype, "durationDays", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1000000),
    __metadata("design:type", Number)
], CreateMembershipPlanDto.prototype, "monthlyCredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => PlanPerksDto),
    __metadata("design:type", PlanPerksDto)
], CreateMembershipPlanDto.prototype, "perks", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["active", "offline"]),
    __metadata("design:type", String)
], CreateMembershipPlanDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], CreateMembershipPlanDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CreateMembershipPlanDto.prototype, "userGroupCode", void 0);
class UpdateMembershipPlanDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], UpdateMembershipPlanDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], UpdateMembershipPlanDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], UpdateMembershipPlanDto.prototype, "priceCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(3650),
    __metadata("design:type", Number)
], UpdateMembershipPlanDto.prototype, "durationDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1000000),
    __metadata("design:type", Number)
], UpdateMembershipPlanDto.prototype, "monthlyCredits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => PlanPerksDto),
    __metadata("design:type", PlanPerksDto)
], UpdateMembershipPlanDto.prototype, "perks", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], UpdateMembershipPlanDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], UpdateMembershipPlanDto.prototype, "userGroupCode", void 0);
class PlanStatusDto {
}
__decorate([
    (0, class_validator_1.IsIn)(["active", "offline"]),
    __metadata("design:type", String)
], PlanStatusDto.prototype, "status", void 0);
/** 归一化权益：缺省字段补齐，避免库里出现半份 JSON */
function normalizePerks(input) {
    const base = (0, membership_service_1.parsePerks)(JSON.stringify(input ?? {}));
    return {
        fastChannel: input?.fastChannel ?? base.fastChannel,
        maxConcurrent: input?.maxConcurrent ?? base.maxConcurrent,
        addonDiscountBps: input?.addonDiscountBps ?? base.addonDiscountBps,
    };
}
function planView(plan) {
    const perks = (0, membership_service_1.parsePerks)(plan.perks);
    return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        durationDays: plan.durationDays,
        monthlyCredits: plan.monthlyCredits,
        perks,
        /** 权益文案由后端生成，后台与 C 端不会各写一套 */
        perkLabels: (0, membership_service_1.buildPerkLabels)(perks, plan.monthlyCredits),
        status: plan.status,
        sortOrder: plan.sortOrder,
        /** 会员等级映射的用户分组；空串 = 落 `default` 分组 */
        userGroupCode: plan.userGroupCode ?? "",
        memberCount: plan._count?.memberships ?? 0,
        orderCount: plan._count?.orders ?? 0,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
    };
}
/** 会员套餐管理：C 端价目表的唯一写入入口 */
let AdminMembershipPlansService = class AdminMembershipPlansService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list() {
        const plans = await this.prisma.membershipPlan.findMany({
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: { _count: { select: { memberships: true, orders: true } } },
        });
        return { items: plans.map(planView) };
    }
    async create(dto) {
        if (dto.code === "free") {
            throw new app_exception_1.AppError(40001, "free 套餐由系统内置，不能重复创建", 400);
        }
        if (dto.durationDays === 0) {
            throw new app_exception_1.AppError(40001, "可购买的套餐周期必须大于 0 天", 400);
        }
        const perks = normalizePerks(dto.perks);
        const exists = await this.prisma.membershipPlan.findUnique({
            where: { code: dto.code },
        });
        if (exists)
            throw new app_exception_1.AppError(40901, `套餐编码 ${dto.code} 已存在`, 409);
        const userGroupCode = await this.resolveUserGroupCode(dto.userGroupCode);
        const plan = await this.prisma.membershipPlan.create({
            data: {
                code: dto.code,
                name: dto.name,
                description: dto.description ?? "",
                priceCents: dto.priceCents,
                durationDays: dto.durationDays,
                monthlyCredits: dto.monthlyCredits,
                perks: JSON.stringify(perks),
                // 默认下架：运营建完套餐应先核对价目与权益，再手动上架
                status: dto.status ?? "offline",
                sortOrder: dto.sortOrder ?? 0,
                userGroupCode,
            },
            include: { _count: { select: { memberships: true, orders: true } } },
        });
        return planView(plan);
    }
    async update(id, dto) {
        const existing = await this.prisma.membershipPlan.findUnique({
            where: { id },
        });
        if (!existing)
            throw new app_exception_1.AppError(40400, "会员套餐不存在", 404);
        if (existing.code === "free") {
            if (dto.priceCents !== undefined && dto.priceCents !== 0) {
                throw new app_exception_1.AppError(40001, "free 套餐必须保持 0 元", 400);
            }
            if (dto.durationDays !== undefined && dto.durationDays !== 0) {
                throw new app_exception_1.AppError(40001, "free 套餐必须是永久有效", 400);
            }
        }
        else if (dto.durationDays === 0) {
            throw new app_exception_1.AppError(40001, "可购买的套餐周期必须大于 0 天", 400);
        }
        const data = {};
        for (const key of [
            "name",
            "description",
            "priceCents",
            "durationDays",
            "monthlyCredits",
            "sortOrder",
        ]) {
            if (dto[key] !== undefined)
                data[key] = dto[key];
        }
        if (dto.perks !== undefined) {
            // 修改权益只影响新订单；存量会员用 Membership.perksSnapshot，不会被追溯改价
            data.perks = JSON.stringify(normalizePerks(dto.perks));
        }
        if (dto.userGroupCode !== undefined) {
            data.userGroupCode = await this.resolveUserGroupCode(dto.userGroupCode);
        }
        const plan = await this.prisma.membershipPlan.update({
            where: { id },
            data,
            include: { _count: { select: { memberships: true, orders: true } } },
        });
        return planView(plan);
    }
    /**
     * 校验并归一会员等级要映射的用户分组。
     *
     * 空串 = 不映射 = 落 `default` 分组（合法的兜底）。
     * 非空时**必须存在**：写一个不存在的分组编码不会报错，只会让所有该等级的用户
     * 在取分组时静默回落默认组 —— 运营以为配了专属分组，实际倍率与渠道可见性
     * 一点都没生效。故在这里显式拒绝。
     */
    async resolveUserGroupCode(raw) {
        const code = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (code === "")
            return "";
        const group = await this.prisma.userGroup.findFirst({
            where: { activeKey: code, deletedAt: null },
            select: { id: true },
        });
        if (!group)
            throw new app_exception_1.AppError(40001, `用户分组 ${code} 不存在，请先在「用户分组」中创建`, 400);
        return code;
    }
    async setStatus(id, dto) {
        const existing = await this.prisma.membershipPlan.findUnique({
            where: { id },
        });
        if (!existing)
            throw new app_exception_1.AppError(40400, "会员套餐不存在", 404);
        if (existing.code === "free" && dto.status === "offline") {
            throw new app_exception_1.AppError(40001, "free 套餐不能下架", 400);
        }
        const plan = await this.prisma.membershipPlan.update({
            where: { id },
            data: { status: dto.status },
            include: { _count: { select: { memberships: true, orders: true } } },
        });
        return planView(plan);
    }
};
exports.AdminMembershipPlansService = AdminMembershipPlansService;
exports.AdminMembershipPlansService = AdminMembershipPlansService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminMembershipPlansService);
let AdminMembershipPlansController = class AdminMembershipPlansController {
    constructor(plans) {
        this.plans = plans;
    }
    list() {
        return this.plans.list();
    }
    create(dto) {
        return this.plans.create(dto);
    }
    update(id, dto) {
        return this.plans.update(id, dto);
    }
    setStatus(id, dto) {
        return this.plans.setStatus(id, dto);
    }
};
exports.AdminMembershipPlansController = AdminMembershipPlansController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminMembershipPlansController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("membership-plan.create"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateMembershipPlanDto]),
    __metadata("design:returntype", void 0)
], AdminMembershipPlansController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("membership-plan.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateMembershipPlanDto]),
    __metadata("design:returntype", void 0)
], AdminMembershipPlansController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(":id/status"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("membership-plan.status"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, PlanStatusDto]),
    __metadata("design:returntype", void 0)
], AdminMembershipPlansController.prototype, "setStatus", null);
exports.AdminMembershipPlansController = AdminMembershipPlansController = __decorate([
    (0, common_1.Controller)("admin/membership-plans"),
    __metadata("design:paramtypes", [AdminMembershipPlansService])
], AdminMembershipPlansController);
//# sourceMappingURL=membership-plans.controller.js.map