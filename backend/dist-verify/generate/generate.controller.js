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
exports.GenerateController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const generate_service_1 = require("./generate.service");
const create_generation_dto_1 = require("./dto/create-generation.dto");
const rate_limit_guard_1 = require("../common/rate-limit.guard");
let GenerateController = class GenerateController {
    constructor(generateService) {
        this.generateService = generateService;
    }
    /*
     * 生成限流按**用户**计：换 IP 不该换来更多额度 —— 每名额度的成本是模型
     * 调用与积分，而积分是用户自己的。20 次/分钟足够覆盖任何手工操作节奏。
     */
    create(user, dto, idempotencyHeader) {
        return this.generateService.createTask(user.id, dto, idempotencyHeader);
    }
};
exports.GenerateController = GenerateController;
__decorate([
    (0, rate_limit_guard_1.RateLimit)({ name: 'generate', limit: 20, windowSec: 60, scope: 'user' }),
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_generation_dto_1.CreateGenerationDto, String]),
    __metadata("design:returntype", void 0)
], GenerateController.prototype, "create", null);
exports.GenerateController = GenerateController = __decorate([
    (0, common_1.Controller)('generate'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [generate_service_1.GenerateService])
], GenerateController);
//# sourceMappingURL=generate.controller.js.map