"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MobileUploadModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const storage_module_1 = require("../storage/storage.module");
const mobile_upload_service_1 = require("./mobile-upload.service");
const mobile_upload_controller_1 = require("./mobile-upload.controller");
/**
 * 手机上传模块。
 *
 * 依赖: Prisma (落素材记录) + Storage (存文件)。均不反向依赖本模块, 无循环。
 */
let MobileUploadModule = class MobileUploadModule {
};
exports.MobileUploadModule = MobileUploadModule;
exports.MobileUploadModule = MobileUploadModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, storage_module_1.StorageModule],
        controllers: [mobile_upload_controller_1.MobileUploadController],
        providers: [mobile_upload_service_1.MobileUploadService],
    })
], MobileUploadModule);
//# sourceMappingURL=mobile-upload.module.js.map