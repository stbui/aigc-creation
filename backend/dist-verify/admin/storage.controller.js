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
exports.AdminStorageController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const app_exception_1 = require("../common/app.exception");
const storage_service_1 = require("../storage/storage.service");
const permissions_1 = require("./permissions");
const storage_provider_1 = require("../storage/storage.provider");
/**
 * 存储后端管理 (admin-prd.md §3.11 B-62/B-63)。
 *
 * 凭据只从环境变量读 (PRD 明确约束: 界面不可编辑), 因此这里只有
 * 「状态查看」「连通测试」「切换默认后端」三个动作, 没有任何写凭据的端点。
 */
let AdminStorageController = class AdminStorageController {
    constructor(storage) {
        this.storage = storage;
    }
    /** 各后端状态: 是否启用、凭据是否配置(脱敏)、连通性 */
    async status() {
        const backends = await this.storage.status();
        return {
            active: this.storage.activeBackend,
            backends,
            // 明确告知凭据来源, 避免运营到处找"在哪里配"
            credentialSource: '环境变量（STORAGE_BACKEND / OSS_* / MINIO_*）',
            editable: false,
        };
    }
    /** 连通性测试 (B-62): 发真实请求, 返回耗时与结果 */
    async probe(backend) {
        if (backend !== undefined && !(0, storage_provider_1.isStorageBackend)(backend)) {
            throw new app_exception_1.AppError(40001, '非法后端', 400);
        }
        const p = backend !== undefined
            ? this.storage.get(backend)
            : this.storage.getActive();
        if (!p)
            throw new app_exception_1.AppError(40400, `后端未启用: ${backend}`, 404);
        return { backend: p.backend, ...(await p.probe()) };
    }
    /**
     * 切换默认后端。
     *
     * ⚠ 不影响已写入的素材 —— Asset.storageBackend 记录了写入时的后端,
     * 老素材仍从原后端读取。切换只决定**新上传**走哪里。
     */
    setActive(backend) {
        if (backend !== 'local' && backend !== 'oss' && backend !== 'minio') {
            throw new app_exception_1.AppError(40001, '非法后端', 400);
        }
        if (!this.storage.get(backend)) {
            throw new app_exception_1.AppError(40001, `后端未启用: ${backend}`, 400);
        }
        this.storage.setActive(backend);
        return { active: backend, note: '仅对新上传生效, 已写入的素材仍按原后端读取' };
    }
};
exports.AdminStorageController = AdminStorageController;
__decorate([
    (0, common_1.Get)('status'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminStorageController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('probe'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.channelTest),
    (0, admin_decorator_1.AuditAction)('storage.probe'),
    __param(0, (0, common_1.Query)('backend')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminStorageController.prototype, "probe", null);
__decorate([
    (0, common_1.Post)('active'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingWrite),
    (0, admin_decorator_1.AuditAction)('storage.switch'),
    __param(0, (0, common_1.Query)('backend')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminStorageController.prototype, "setActive", null);
exports.AdminStorageController = AdminStorageController = __decorate([
    (0, common_1.Controller)('admin/storage'),
    __metadata("design:paramtypes", [storage_service_1.StorageService])
], AdminStorageController);
//# sourceMappingURL=storage.controller.js.map