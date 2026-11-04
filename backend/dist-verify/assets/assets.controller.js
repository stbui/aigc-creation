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
exports.AssetsController = void 0;
const common_1 = require("@nestjs/common");
const rate_limit_guard_1 = require("../common/rate-limit.guard");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path_1 = require("path");
const crypto_1 = require("crypto");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const env_files_1 = require("../config/env-files");
const assets_service_1 = require("./assets.service");
const app_exception_1 = require("../common/app.exception");
const image_validation_1 = require("./image-validation");
const upload_asset_dto_1 = require("./dto/upload-asset.dto");
const move_asset_dto_1 = require("./dto/move-asset.dto");
let AssetsController = class AssetsController {
    constructor(assetsService) {
        this.assetsService = assetsService;
    }
    // 上传按用户计 30 次/分钟：单次上传是磁盘 + 尺寸探测（Jimp 解码），
    // 批量拖拽 20 张是正常场景，留足余量
    upload(user, file, dto) {
        if (!file)
            throw new app_exception_1.AppError(40001, '请选择要上传的图片', 400);
        return this.assetsService.createOriginal(user.id, dto.projectId, {
            filename: file.filename,
            originalname: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
        }, {
            sourceSite: dto.sourceSite,
            sourceTitle: dto.sourceTitle,
            sourcePageUrl: dto.sourcePageUrl,
        });
    }
    /**
     * 批量移动素材到另一个项目 (分组)。
     *
     * 浏览器扩展的「换分组再保存」是批量语义: 一次选中 N 张、已落到默认分组,
     * 再整体改投目标分组 —— 逐条 PATCH 会放大成 N 次请求且中途失败无法回滚,
     * 故做成批量端点。校验一次目标项目归属, 再按 ownerId 过滤素材。
     */
    move(user, dto) {
        return this.assetsService.moveToProject(user.id, dto.ids, dto.projectId);
    }
    /** 素材库列表: 支持 kind / capability 筛选与分页 */
    list(user, kind, capability, limit, offset, keyword, from, to) {
        return this.assetsService.list(user.id, {
            kind,
            capability,
            limit: Number(limit),
            offset: Number(offset),
            keyword,
            from,
            to,
        });
    }
    /** 单个素材详情: 用户端历史恢复按 id 找回模板与参考图 */
    getOne(user, id) {
        return this.assetsService.getOne(user.id, id);
    }
    /** 删除素材 (生成图会连带删除产出它的任务) */
    remove(user, id) {
        return this.assetsService.remove(user.id, id);
    }
};
exports.AssetsController = AssetsController;
__decorate([
    (0, rate_limit_guard_1.RateLimit)({ name: 'asset-upload', limit: 30, windowSec: 60, scope: 'user' }),
    (0, common_1.Post)('upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.diskStorage)({
            // multer 的 destination 必须在**模块加载期**就确定（它是装饰器参数，
            // 拿不到 DI 的 ConfigService），故直接读 process.env.UPLOAD_DIR。
            // @nestjs/config 在 NestFactory.create 里就把 .env 读进了 process.env，
            // 而 AppModule 的 import 发生在那之后，故此处能读到正确的值。
            destination: `${(0, env_files_1.resolveUploadsDir)()}/original`,
            filename: (_req, file, cb) => {
                const unique = (0, crypto_1.randomUUID)();
                const ext = (0, path_1.extname)(file.originalname) || '.bin';
                cb(null, `${unique}${ext}`);
            },
        }),
        limits: { fileSize: (0, image_validation_1.maxUploadBytes)(), files: 1 },
    })),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, upload_asset_dto_1.UploadAssetDto]),
    __metadata("design:returntype", void 0)
], AssetsController.prototype, "upload", null);
__decorate([
    (0, common_1.Patch)('move'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, move_asset_dto_1.MoveAssetsDto]),
    __metadata("design:returntype", void 0)
], AssetsController.prototype, "move", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('kind')),
    __param(2, (0, common_1.Query)('capability')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('offset')),
    __param(5, (0, common_1.Query)('keyword')),
    __param(6, (0, common_1.Query)('from')),
    __param(7, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], AssetsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AssetsController.prototype, "getOne", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AssetsController.prototype, "remove", null);
exports.AssetsController = AssetsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('assets'),
    __metadata("design:paramtypes", [assets_service_1.AssetsService])
], AssetsController);
//# sourceMappingURL=assets.controller.js.map