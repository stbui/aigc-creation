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
exports.TestSupportController = void 0;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("./app.exception");
const rate_limit_guard_1 = require("./rate-limit.guard");
/**
 * 测试辅助接口（**仅 NODE_ENV=test 可用**）。
 *
 * 为什么需要它
 * ----------
 * 限流是**进程内状态**，且测试档里短信（1 次/分钟 + 5 次/天）、找回密码
 * （3 次/小时）刻意不提供环境变量放宽 —— 它们本来就是要被验证「真的会拒」的
 * 那条路径。可代价是：同一天跑第二遍冒烟，第一批用例就被上一次留下的计数
 * 挡在门外，失败信息看起来像「短信通道坏了」。
 *
 * 于是提供一个显式重置入口：冒烟脚本在开始/结束各清一次计数，二者互不污染。
 * 这不是把限流测掉了 —— 断言仍然打在同一个 guard 上，只是窗口从「进程生命周期」
 * 变成「脚本作用域」。
 *
 * 安全边界
 * -------
 * 1. `NODE_ENV !== 'test'` 时**直接 404**（不是 403）：非测试环境里这个路径
 *    根本不该存在，返回 404 连「这里有个测试后门」都不承认。
 * 2. 需要 `x-test-token` 与 `RATE_LIMIT_RESET_TOKEN` 相等。测试档可能被
 *    接到局域网（手机调试），只靠 IP 判断不够。
 * 3. 令牌未配置 → 一律拒绝，避免「忘了配 = 人人可重置」。
 */
let TestSupportController = class TestSupportController {
    constructor(rateLimit) {
        this.rateLimit = rateLimit;
    }
    reset(token) {
        const env = (process.env.NODE_ENV ?? '').toLowerCase();
        if (env !== 'test') {
            throw new app_exception_1.AppError(40400, 'Not Found', 404);
        }
        const expected = process.env.RATE_LIMIT_RESET_TOKEN ?? '';
        if (!expected || token !== expected) {
            throw new app_exception_1.AppError(40100, '测试令牌无效', 401);
        }
        this.rateLimit.resetAll();
        return { reset: true };
    }
};
exports.TestSupportController = TestSupportController;
__decorate([
    (0, common_1.Post)('rate-limit/reset'),
    __param(0, (0, common_1.Headers)('x-test-token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TestSupportController.prototype, "reset", null);
exports.TestSupportController = TestSupportController = __decorate([
    (0, common_1.Controller)('test'),
    __metadata("design:paramtypes", [rate_limit_guard_1.RateLimitGuard])
], TestSupportController);
//# sourceMappingURL=test-support.controller.js.map