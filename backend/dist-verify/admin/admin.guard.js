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
var AdminGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminGuard = void 0;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("../common/app.exception");
const jwt_service_1 = require("../common/jwt.service");
const prisma_service_1 = require("../prisma/prisma.service");
const admin_role_service_1 = require("./admin-role.service");
const permissions_1 = require("./permissions");
/**
 * 后台第一道守卫: 身份与账号状态。
 *
 * 职责:
 *   1. 仅对 /admin/* 生效 (本守卫全局注册, 非后台路径直接放行)
 *   2. 校验 Bearer token (与 C 端 JwtAuthGuard 同一套签发逻辑, 不重复实现)
 *   3. 实时查库取 role 与 status
 *   4. 非后台角色 / 账号非 active → 403
 *
 * 为什么实时查库: 见 admin-role.service.ts 顶部说明。
 * JWT 载荷里不含 role, 也不写 status —— 两者都是可变状态。
 */
let AdminGuard = AdminGuard_1 = class AdminGuard {
    constructor(prisma, roles) {
        this.prisma = prisma;
        this.roles = roles;
        this.logger = new common_1.Logger(AdminGuard_1.name);
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        // 全局守卫: 非后台路径直接放行, 不解析 token。
        // C 端请求不应因后台鉴权链路而失败, 两者职责必须隔离。
        const url = request.originalUrl ?? request.url ?? '';
        if (!url.split('?')[0].includes('/admin'))
            return true;
        const authHeader = request.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new app_exception_1.AppError(40101, '未认证', 401);
        }
        const token = authHeader.slice('Bearer '.length).trim();
        let payload;
        try {
            payload = jwt_service_1.JwtService.verify(token);
        }
        catch {
            throw new app_exception_1.AppError(40101, '令牌无效或已过期', 401);
        }
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, role: true, status: true },
        });
        if (!user)
            throw new app_exception_1.AppError(40101, '令牌无效或已过期', 401);
        if (user.status === 'disabled')
            throw new app_exception_1.AppError(40302, '账号已被禁用', 403);
        if (user.status === 'deleted')
            throw new app_exception_1.AppError(40302, '账号已注销', 403);
        if (!(0, permissions_1.isAdminRole)(user.role)) {
            // 用 warn 而非 debug: C 端用户误入后台是运营需要察觉的信号
            this.logger.warn(`非后台用户访问后台接口: ${user.email} (role=${user.role})`);
            throw new app_exception_1.AppError(40301, '需要管理员权限', 403);
        }
        request.adminUser = { id: user.id, email: user.email, role: user.role };
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = AdminGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        admin_role_service_1.AdminRoleService])
], AdminGuard);
//# sourceMappingURL=admin.guard.js.map