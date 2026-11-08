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
exports.AdminTasksController = exports.TaskBatchDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
const tasks_admin_service_1 = require("./tasks-admin.service");
const permissions_1 = require("./permissions");
const app_exception_1 = require("../common/app.exception");
const csv_response_1 = require("../common/csv-response");
// 值导入: DTO 依赖 design:paramtypes 做实例化与白名单剥离
const task_dto_1 = require("./dto/task.dto");
/**
 * 任务监控 (admin-prd.md §3.5 B-28~B-33)。
 *
 * 权限四点分离:读 (task.read) / 重试 (task.retry) / 终止 (task.cancel) /
 * 删除 (task.delete)。运营需要读全部任务来回答用户"我的图怎么还没出来",
 * 但重试会真实消耗模型额度、终止会作废排队、删除会清理产出,
 * 三者都超出「查看」范畴。
 *
 * 路由顺序: 字面量路径 (`stats` / `capabilities`) 须在 `:id` 之前,
 * 否则被参数路由抢占。
 */
/** 批量重试 / 终止 / 删除 */
class TaskBatchDto {
}
exports.TaskBatchDto = TaskBatchDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100, { message: "单次批量最多 100 条" }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], TaskBatchDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["retry", "cancel", "delete"], {
        message: "action 只能是 retry、cancel 或 delete",
    }),
    __metadata("design:type", String)
], TaskBatchDto.prototype, "action", void 0);
let AdminTasksController = class AdminTasksController {
    constructor(tasks, roles) {
        this.tasks = tasks;
        this.roles = roles;
    }
    /** 拥堵指标 (B-31)。独立端点: 顶部告警条需高频刷新, 不必连带拉整页列表 */
    stats() {
        return this.tasks.congestion();
    }
    /** 能力下拉项。取自 registry 而非硬编码, 新增能力无需改前端 */
    capabilities() {
        return this.tasks.capabilityOptions();
    }
    /**
     * 批量重试 / 终止 / 删除（B7）。
     *
     * 权限按 action 判定：重试要 `task.retry`，终止要 `task.cancel`，
     * 删除要 `task.delete`。三者都会真实影响用户可见状态或产出，
     * 所以批量入口不能只凭 `task.read` 就放行。
     */
    async batch(dto, actor, req) {
        if (dto.action === "delete") {
            req.auditExtra = { batchAction: "delete", taskIds: dto.ids };
        }
        const needed = dto.action === "retry"
            ? permissions_1.PERMISSIONS.taskRetry
            : dto.action === "cancel"
                ? permissions_1.PERMISSIONS.taskCancel
                : permissions_1.PERMISSIONS.taskDelete;
        if (!(await this.roles.hasPermission(actor.id, needed))) {
            throw new app_exception_1.AppError(40301, `没有执行该批量动作的权限（${needed}）`, 403);
        }
        return this.tasks.batchAction(dto.ids, dto.action);
    }
    /** 任务列表 + 拥堵统计 + 筛选项 (B-28 / B-29) */
    list(query) {
        return this.tasks.list(query);
    }
    /**
     * 导出任务 (CSV)。
     *
     * 路由必须声明在 `:id` 之前，否则 `export` 会被当成任务 id。
     * 导出把用户数据带出系统，用独立的 `data.export` 权限点并留审计。
     */
    async export(query, res) {
        const csv = await this.tasks.exportCsv(query);
        (0, csv_response_1.sendCsv)(res, "tasks", csv);
    }
    /** 任务详情: 输入素材 / 参数 JSON / 产出图 / 时间线 (B-30) */
    detail(id) {
        return this.tasks.detail(id);
    }
    /**
     * 删除已结束任务。
     *
     * 删除会清理任务记录、子任务、产出素材与存储文件, 不可恢复。
     * 排队中/执行中的任务必须先终止, 避免 worker 继续操作已删除的任务。
     */
    remove(id) {
        return this.tasks.remove(id);
    }
    /**
     * 失败重试 (B-32): 用原参数与输入新建任务。
     *
     * 挂审计 —— 重试触发真实生成, 会消耗模型额度, 事后必须可追溯。
     */
    retry(id) {
        return this.tasks.retry(id);
    }
    /**
     * 终止运行中任务 (B-33): 作废排队与产出, 用户端立即可见失败。
     *
     * 终止是作废用户已提交的动作, 属高危, 必须留审计。
     */
    cancel(id) {
        return this.tasks.cancel(id);
    }
};
exports.AdminTasksController = AdminTasksController;
__decorate([
    (0, common_1.Get)("stats"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)("capabilities"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "capabilities", null);
__decorate([
    (0, common_1.Post)("batch"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskRead),
    (0, admin_decorator_1.AuditAction)("task.batch"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [TaskBatchDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminTasksController.prototype, "batch", null);
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [task_dto_1.TaskListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.taskRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [task_dto_1.TaskListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminTasksController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "detail", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskDelete),
    (0, admin_decorator_1.AuditAction)("task.delete"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(":id/retry"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskRetry),
    (0, admin_decorator_1.AuditAction)("task.retry"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "retry", null);
__decorate([
    (0, common_1.Post)(":id/cancel"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.taskCancel),
    (0, admin_decorator_1.AuditAction)("task.cancel"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminTasksController.prototype, "cancel", null);
exports.AdminTasksController = AdminTasksController = __decorate([
    (0, common_1.Controller)("admin/tasks"),
    __metadata("design:paramtypes", [tasks_admin_service_1.TasksAdminService,
        admin_role_service_1.AdminRoleService])
], AdminTasksController);
//# sourceMappingURL=tasks-admin.controller.js.map