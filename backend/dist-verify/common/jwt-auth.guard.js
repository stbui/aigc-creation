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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("./app.exception");
const jwt_service_1 = require("./jwt.service");
const prisma_service_1 = require("../prisma/prisma.service");
/**
 * Bearer Token 鉴权守卫: 校验 Authorization 头, 解析后将用户写入 request.user。
 *
 * ## 为什么每次请求都要查一次库 (2026-10-21)
 *
 * 此前只验签名 —— token 有效期 7 天, 意味着后台禁用/注销一个账号后,
 * 该用户仍能凭旧 token 继续调 20+ 个接口, 直到 token 自然过期。
 * 「禁用立即生效」是账号体系的基本承诺, 不能靠 token 过期兜底。
 *
 * 代价是一次按主键的 SQLite 查询 (只取 status 一列), 与业务查询相比可忽略;
 * 不做内存缓存的理由: 缓存窗口内被禁用的账号仍可用, 正好把"立即生效"
 * 退化成"几秒后生效" —— 省下的这点开销不值得。
 *
 * 账号被**硬删除**时查不到记录, 同样按未认证处理。
 */
let JwtAuthGuard = class JwtAuthGuard {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
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
            select: { id: true, email: true, status: true, tokenVersion: true },
        });
        if (!user) {
            // 账号已被硬删除: 签名仍然有效, 但主体已不存在
            throw new app_exception_1.AppError(40101, '账号不存在或已注销', 401);
        }
        /*
         * 令牌版本比对: 改密 / 重置密码 / 注销会把 User.tokenVersion 自增,
         * 持旧 token 的会话在下一次请求即失效 —— 这是「改密后踢掉所有旧会话」
         * 的唯一实现, 不依赖黑名单表。
         */
        if ((payload.tv ?? 0) !== user.tokenVersion) {
            throw new app_exception_1.AppError(40102, '密码已变更，请重新登录', 401);
        }
        if (user.status === 'disabled') {
            throw new app_exception_1.AppError(40302, '账号已被禁用', 403);
        }
        if (user.status === 'deleted') {
            throw new app_exception_1.AppError(40302, '账号已注销', 403);
        }
        request.user = { id: user.id, email: user.email };
        return true;
    }
};
exports.JwtAuthGuard = JwtAuthGuard;
exports.JwtAuthGuard = JwtAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JwtAuthGuard);
//# sourceMappingURL=jwt-auth.guard.js.map