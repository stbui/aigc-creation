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
var RateLimitGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitGuard = exports.RateLimit = void 0;
/**
 * 限流（固定窗口，单机内存）。
 *
 * 保护面
 * ----
 * 登录 / 注册 / 找回密码 / 短信验证码 / 生成 / 上传 —— 这些接口的共同点是
 * **每次都产生真实成本**: 密码哈希是 CPU、短信是真金白银、生成是模型调用与积分、
 * 上传是磁盘。没有限流等于把这些成本的控制权交给对方。
 *
 * 为什么是固定窗口而不是令牌桶
 * -------------------------
 * 固定窗口实现只需一个计数器，读代码的人一眼能算出「N 次 / M 秒」，排障时
 * 用户问「为什么现在不行」能直接回答「窗口还剩 X 秒」。令牌桶的平滑速率
 * 对这类低频接口没有收益，反而让上限难以解释。
 * 已知代价：窗口边界处可能出现 2N 次的突发（例如 59s 与 61s 各打满一次）。
 * 对本项目要防的场景（暴力破解、刷验证码、刷生成）足够。
 *
 * ⚠ 单机内存，多实例部署时每个实例各算各的。真要做全局限流需要 Redis，
 * 属于本轮不做（见 docs/environments.md 的说明）。
 *
 * 客户端身份
 * --------
 * · `scope: 'user'`：从 Authorization 直接解 JWT 取 sub（不复用 JwtAuthGuard，
 *   因为全局守卫先于控制器级守卫执行，那时 `request.user` 还不存在）；
 *   令牌无效时退回按 IP —— 无效令牌的请求本来就过不了鉴权，但让它无限撞击
 *   鉴权逻辑同样不划算。
 * · `scope: 'ip'`：`request.ip`。是否信任 `X-Forwarded-For` 由 Express 的
 *   `trust proxy` 决定，见 main.ts 的 RATE_LIMIT_TRUST_PROXY —— 默认**不信任**。
 *   不设防时任何人都能用伪造的 XFF 头绕开所有限流。
 */
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const app_exception_1 = require("./app.exception");
const jwt_service_1 = require("./jwt.service");
const RATE_LIMIT_KEY = 'rate_limit';
const RateLimit = (options) => (0, common_1.SetMetadata)(RATE_LIMIT_KEY, options);
exports.RateLimit = RateLimit;
let RateLimitGuard = RateLimitGuard_1 = class RateLimitGuard {
    constructor(reflector) {
        this.reflector = reflector;
        this.logger = new common_1.Logger(RateLimitGuard_1.name);
        this.buckets = new Map();
        this.enabled = (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false';
        // 定期清过期桶：不清理的话 key 数会随 IP 基数无限增长，长期运行必然吃内存
        const timer = setInterval(() => this.sweep(), 60_000);
        timer.unref?.();
        if (!this.enabled) {
            this.logger.warn('RATE_LIMIT_ENABLED=false：全站限流已关闭（仅限本地压测，生产禁用）');
        }
    }
    canActivate(context) {
        if (!this.enabled)
            return true;
        const options = this.reflector.getAllAndOverride(RATE_LIMIT_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!options)
            return true;
        const http = context.switchToHttp();
        const req = http.getRequest();
        const res = http.getResponse();
        const scope = options.scope ?? 'ip';
        const identity = scope === 'user' ? this.userIdOf(req) : this.ipOf(req);
        const bucketName = options.name ?? `${context.getClass().name}.${context.getHandler().name}`;
        const rules = (options.rules && options.rules.length > 0
            ? options.rules
            : [{ limit: options.limit ?? 60, windowSec: options.windowSec ?? 60 }]).map((r) => ({ ...r }));
        if (options.limitEnv) {
            const override = Number(process.env[options.limitEnv]);
            if (Number.isFinite(override) && override > 0)
                rules[0].limit = override;
        }
        const now = Date.now();
        let remaining = Number.POSITIVE_INFINITY;
        let limit = 0;
        for (let i = 0; i < rules.length; i += 1) {
            const rule = rules[i];
            const key = `${bucketName}#${i}|${scope}|${identity}`;
            let bucket = this.buckets.get(key);
            if (!bucket || bucket.resetAt <= now) {
                bucket = { count: 0, resetAt: now + rule.windowSec * 1000 };
                this.buckets.set(key, bucket);
            }
            bucket.count += 1;
            if (bucket.count > rule.limit) {
                const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
                // Retry-After 必须回写给客户端：前端据此展示「X 秒后再试」，
                // 而不是让用户盲目重复点，越点越久
                res?.setHeader?.('Retry-After', String(retryAfter));
                throw new app_exception_1.AppError(42901, `操作过于频繁，请 ${retryAfter} 秒后再试`, 429);
            }
            remaining = Math.min(remaining, rule.limit - bucket.count);
            limit = Math.max(limit, rule.limit);
        }
        // 剩余次数回写，前端可据此提前禁用按钮（非强制，见响应头）
        res?.setHeader?.('X-RateLimit-Limit', String(limit));
        res?.setHeader?.('X-RateLimit-Remaining', String(Math.max(0, remaining)));
        return true;
    }
    ipOf(req) {
        // Express 会根据 trust proxy 决定 req.ip 是否取自 X-Forwarded-For。
        // 未开启 trust proxy 时这是 TCP 对端地址，客户端改不了。
        return req.ip || req.socket?.remoteAddress || 'unknown';
    }
    userIdOf(req) {
        const header = req.headers['authorization'];
        if (typeof header === 'string' && header.startsWith('Bearer ')) {
            try {
                return jwt_service_1.JwtService.verify(header.slice('Bearer '.length).trim()).sub;
            }
            catch {
                // 令牌无效 → 退回 IP 计数，避免匿名请求绕过限流
            }
        }
        return `anon:${this.ipOf(req)}`;
    }
    sweep() {
        const now = Date.now();
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now)
                this.buckets.delete(key);
        }
    }
    /** 测试用：清空所有计数（冒烟脚本连跑需要从零开始） */
    resetAll() {
        this.buckets.clear();
    }
};
exports.RateLimitGuard = RateLimitGuard;
exports.RateLimitGuard = RateLimitGuard = RateLimitGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], RateLimitGuard);
//# sourceMappingURL=rate-limit.guard.js.map