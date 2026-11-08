"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma.service");
/**
 * 数据库模块 —— 全局可见。
 *
 * 为什么是 @Global: JwtAuthGuard 需要按请求校验账号状态 (禁用/注销的账号
 * 不能凭旧 token 继续访问), 而它是 `@UseGuards(JwtAuthGuard)` 形式挂在
 * 十几个功能模块上。守卫由**使用它的模块**的注入器实例化, 因此 PrismaService
 * 必须在每个模块可见 —— 漏掉一个模块就表现为运行时 `Cannot read properties
 * of undefined`, 而不是编译错误。
 *
 * 改成全局后, 新增模块无需再显式 import PrismaModule; 已显式 import 的模块
 * 保持原样也能工作 (重复导入同一个 provider 不产生新实例, 全局模块的导出
 * 优先)。
 */
let PrismaModule = class PrismaModule {
};
exports.PrismaModule = PrismaModule;
exports.PrismaModule = PrismaModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [prisma_service_1.PrismaService],
        exports: [prisma_service_1.PrismaService],
    })
], PrismaModule);
//# sourceMappingURL=prisma.module.js.map