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
exports.TasksController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const generate_service_1 = require("./generate.service");
let TasksController = class TasksController {
    constructor(generateService) {
        this.generateService = generateService;
    }
    /**
     * 分页任务列表。
     *
     * ⚠ 必须注册在 `:id` 之前，否则 `/tasks/page` 会被当成 id='page'。
     */
    listPage(user, projectId, capability, limit, offset) {
        const n = Number(limit ?? 50);
        const skip = Number(offset ?? 0);
        return this.generateService.listTasksPage(user.id, {
            projectId,
            capability,
            limit: Number.isFinite(n) ? n : 50,
            offset: Number.isFinite(skip) ? skip : 0,
        });
    }
    getOne(user, id) {
        return this.generateService.getTask(user.id, id);
    }
    list(user, projectId) {
        return this.generateService.listTasks(user.id, projectId);
    }
    /** 删除作品记录 (同时删除其产出的生成图与磁盘文件) */
    remove(user, id) {
        return this.generateService.removeTask(user.id, id);
    }
};
exports.TasksController = TasksController;
__decorate([
    (0, common_1.Get)('page'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('projectId')),
    __param(2, (0, common_1.Query)('capability')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "listPage", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "getOne", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "list", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "remove", null);
exports.TasksController = TasksController = __decorate([
    (0, common_1.Controller)('tasks'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [generate_service_1.GenerateService])
], TasksController);
//# sourceMappingURL=tasks.controller.js.map