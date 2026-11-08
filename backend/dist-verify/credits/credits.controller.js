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
exports.CreditsController = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const credit_service_1 = require("./credit.service");
/** C 端积分接口: 用户查自己的余额、批次与流水 */
let CreditsController = class CreditsController {
    constructor(credit) {
        this.credit = credit;
    }
    /** 余额总览 (B-49): 顶导展示用 */
    balance(user) {
        return this.credit.balanceOf(user.id);
    }
    /** 批次明细 (B-50) */
    lots(user, include) {
        return this.credit.lotsOf(user.id, include !== 'false');
    }
    /** 流水查询 (B-51，支持 limit/offset 分页与 type/direction 筛选) */
    ledger(user, limit, offset, type, direction) {
        const n = Number(limit ?? 50);
        const skip = Number(offset ?? 0);
        return this.credit.ledgerOf(user.id, Number.isFinite(n) ? Math.min(n, 200) : 50, {
            offset: Number.isFinite(skip) ? Math.max(skip, 0) : 0,
            type,
            direction,
        });
    }
};
exports.CreditsController = CreditsController;
__decorate([
    (0, common_1.Get)('balance'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CreditsController.prototype, "balance", null);
__decorate([
    (0, common_1.Get)('lots'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('includeExpired')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CreditsController.prototype, "lots", null);
__decorate([
    (0, common_1.Get)('ledger'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('offset')),
    __param(3, (0, common_1.Query)('type')),
    __param(4, (0, common_1.Query)('direction')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CreditsController.prototype, "ledger", null);
exports.CreditsController = CreditsController = __decorate([
    (0, common_1.Controller)('credits'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [credit_service_1.CreditService])
], CreditsController);
//# sourceMappingURL=credits.controller.js.map