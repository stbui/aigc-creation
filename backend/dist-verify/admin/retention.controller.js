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
exports.AdminRetentionController = exports.RetentionPreviewQueryDto = exports.RetentionCleanupDto = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const backup_service_1 = require("./backup.service");
const settings_service_1 = require("./settings.service");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const permissions_1 = require("./permissions");
const TARGETS = [
    {
        table: "AdminAuditLog",
        label: "后台操作审计",
        defaultDays: 180,
        note: "合规要求可追溯, 默认保留半年; 实际天数取系统设置 retention.auditLogDays",
    },
    {
        table: "ApiCallLog",
        label: "调用记录",
        defaultDays: 90,
        note: "排障窗口通常为一周, 保留三个月足够定位问题且不至于无限增长",
    },
    {
        table: "BackupRecord",
        label: "备份记录",
        defaultDays: 180,
        note: "备份文件按份数裁剪, 记录留半年便于回溯哪次备份可恢复",
    },
    {
        table: "CleanupLog",
        label: "清理日志",
        defaultDays: 365,
        note: '清理自身的记录保留最久, 否则"谁删了什么"将无从查证',
    },
];
const TABLE_NAMES = TARGETS.map((t) => t.table);
/** 手动清理 */
class RetentionCleanupDto {
}
exports.RetentionCleanupDto = RetentionCleanupDto;
__decorate([
    (0, class_validator_1.IsIn)(TABLE_NAMES, { message: "不支持清理该目标" }),
    __metadata("design:type", String)
], RetentionCleanupDto.prototype, "target", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(7, { message: "保留天数至少为 7 天" }),
    (0, class_validator_1.Max)(3650),
    __metadata("design:type", Number)
], RetentionCleanupDto.prototype, "retentionDays", void 0);
/** 按指定目标与天数重新预览影响范围 */
class RetentionPreviewQueryDto {
}
exports.RetentionPreviewQueryDto = RetentionPreviewQueryDto;
__decorate([
    (0, class_validator_1.IsIn)(TABLE_NAMES, { message: "不支持预览该目标" }),
    __metadata("design:type", String)
], RetentionPreviewQueryDto.prototype, "target", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(7, { message: "保留天数至少为 7 天" }),
    (0, class_validator_1.Max)(3650),
    __metadata("design:type", Number)
], RetentionPreviewQueryDto.prototype, "retentionDays", void 0);
let AdminRetentionController = class AdminRetentionController {
    constructor(prisma, backup, settings) {
        this.prisma = prisma;
        this.backup = backup;
        this.settings = settings;
    }
    /**
     * 可清理目标 + 当前数据量。
     *
     * 同时给出「当前条数 / 最早一条的时间 / 按默认天数会被删多少」——
     * 只显示条数的话, 运营点下确认前无法判断这次清理影响有多大。
     */
    async targets() {
        const auditDays = Number(await this.settings.get("retention.auditLogDays")) || 180;
        return Promise.all(TARGETS.map(async (t) => {
            const days = t.table === "AdminAuditLog" ? auditDays : t.defaultDays;
            return this.previewTarget(t, days);
        }));
    }
    /** 确认清理前按用户当前天数重新估算，避免拿页面上过期数字做不可逆操作 */
    async preview(query) {
        const target = TARGETS.find((item) => item.table === query.target);
        if (!target) {
            throw new app_exception_1.AppError(40001, `不支持预览该目标: ${query.target}`, 400);
        }
        return this.previewTarget(target, query.retentionDays);
    }
    /** 清理历史记录 */
    async logs(pageSize) {
        const raw = Number(pageSize ?? 50);
        const take = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
        return this.prisma.cleanupLog.findMany({
            orderBy: { createdAt: "desc" },
            take,
        });
    }
    /**
     * 触发清理。
     *
     * 复用 BackupService.cleanupExpired —— 与调度任务走同一条路径,
     * 避免"手动清理"和"定时清理"两套逻辑在保留天数上各说各话。
     */
    cleanup(dto) {
        if (!TABLE_NAMES.includes(dto.target)) {
            throw new app_exception_1.AppError(40001, `不支持清理该目标: ${dto.target}`, 400);
        }
        return this.backup.cleanupExpired(dto.target, dto.retentionDays, "manual");
    }
    async previewTarget(t, days) {
        const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
        const delegate = this.prisma[delegateName(t.table)];
        const [total, expired, oldest] = await Promise.all([
            delegate.count(),
            delegate.count({ where: { createdAt: { lt: cutoff } } }),
            delegate.findFirst({
                orderBy: { createdAt: "asc" },
                select: { createdAt: true },
            }),
        ]);
        return {
            table: t.table,
            label: t.label,
            note: t.note,
            retentionDays: days,
            total,
            /** 按指定天数会被删除的条数 (未执行, 仅预估) */
            expiring: expired,
            cutoff: cutoff.toISOString(),
            oldestAt: oldest?.createdAt ?? null,
        };
    }
};
exports.AdminRetentionController = AdminRetentionController;
__decorate([
    (0, common_1.Get)("targets"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminRetentionController.prototype, "targets", null);
__decorate([
    (0, common_1.Get)("preview"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RetentionPreviewQueryDto]),
    __metadata("design:returntype", Promise)
], AdminRetentionController.prototype, "preview", null);
__decorate([
    (0, common_1.Get)("logs"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRead),
    __param(0, (0, common_1.Query)("pageSize")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminRetentionController.prototype, "logs", null);
__decorate([
    (0, common_1.Post)("cleanup"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRun),
    (0, admin_decorator_1.AuditAction)("data.cleanup"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RetentionCleanupDto]),
    __metadata("design:returntype", void 0)
], AdminRetentionController.prototype, "cleanup", null);
exports.AdminRetentionController = AdminRetentionController = __decorate([
    (0, common_1.Controller)("admin/retention"),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        backup_service_1.BackupService,
        settings_service_1.AdminSettingsService])
], AdminRetentionController);
/** `AdminAuditLog` → `adminAuditLog`, Prisma 委托名首字母小写 */
function delegateName(table) {
    return table.charAt(0).toLowerCase() + table.slice(1);
}
//# sourceMappingURL=retention.controller.js.map