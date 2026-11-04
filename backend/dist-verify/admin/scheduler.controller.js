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
exports.AdminSchedulerController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const app_exception_1 = require("../common/app.exception");
const scheduler_service_1 = require("./scheduler.service");
const permissions_1 = require("./permissions");
/**
 * 允许手动触发的任务 —— 只开放幂等且低风险的,备份/清理不在此列。
 *
 * `task-recover` 也在白名单里: 它把心跳超时的 running 任务判失败并退款,
 * 两条路径都以条件更新抢占, 重复触发不会重复退款, 排在人工排障时的第一选择。
 */
const MANUALLY_RUNNABLE = ['order-expire', 'credit-expire', 'membership', 'task-recover'];
/**
 * 调度器可观测 (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 为什么需要它: 一个静默失败三周的定时任务比不设更危险 ——
 * 所有人都会以为它在跑。必须让人能随时看到"每个任务上次跑没跑、跑成功没有、
 * 连续失败几次", 连续失败 > 0 时立刻能发现。
 */
let AdminSchedulerController = class AdminSchedulerController {
    constructor(scheduler) {
        this.scheduler = scheduler;
    }
    /** 各任务最近执行状态 */
    status() {
        return {
            tasks: this.scheduler.taskStatus(),
            manuallyRunnable: MANUALLY_RUNNABLE,
            // 哪些任务当前有连续失败 —— 前端可据此置顶告警
            failing: this.scheduler
                .taskStatus()
                .filter((t) => t.consecutiveFailures > 0)
                .map((t) => t.name),
        };
    }
    /**
     * 手动触发任务。
     *
     * ⚠ **只开放幂等任务**: 超时订单关闭与积分回收都是"扫一批已到期的",
     * 重复执行不会产生副作用。而备份/清理会写文件或删数据, 不适合被随意手动触发。
     */
    run(task) {
        if (!MANUALLY_RUNNABLE.includes(task)) {
            throw new app_exception_1.AppError(40001, `不支持手动触发: ${task} (可触发: ${MANUALLY_RUNNABLE.join(', ')})`, 400);
        }
        return this.scheduler.runNow(task);
    }
};
exports.AdminSchedulerController = AdminSchedulerController;
__decorate([
    (0, common_1.Get)('status'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminSchedulerController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('run'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingWrite),
    (0, admin_decorator_1.AuditAction)('scheduler.run'),
    __param(0, (0, common_1.Query)('task')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminSchedulerController.prototype, "run", null);
exports.AdminSchedulerController = AdminSchedulerController = __decorate([
    (0, common_1.Controller)('admin/scheduler'),
    __metadata("design:paramtypes", [scheduler_service_1.SchedulerService])
], AdminSchedulerController);
//# sourceMappingURL=scheduler.controller.js.map