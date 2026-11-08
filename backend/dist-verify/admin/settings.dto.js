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
exports.UpdateSettingsDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * 写入系统设置（kv 结构）。
 *
 * ⚠️ 这里**不再逐字段声明校验装饰器** —— 那是「加一项设置要改 4 处」的根源
 * （`SETTING_DEFS` + DTO 装饰器 + 驼峰↔点号映射表 + 前端手写联合类型），
 * 任一处漏改就静默漂移。
 *
 * ⚠️ DTO 必须用值导入 (不能用 `import type`)。
 * `import type` 会在编译期抹掉类的运行时值, 使 design:paramtypes 退化成 Function,
 * ValidationPipe 因此无法识别类型 —— @Body 拿到的是未校验的原始 body,
 * 结果是「请求 200 但 DTO 上一个字段都没生效」, 比直接报错更难排查。
 *
 * 白名单与类型校验在 service 层按 `SETTING_DEFS` 做 —— **未知键直接 400**。
 * 这比此前「白名单静默剥离 → 再报 400 没有需要更新的设置项」的两段式失败更直接：
 * 运营改错键名时会立刻看到是哪个键不认识。
 */
class UpdateSettingsDto {
}
exports.UpdateSettingsDto = UpdateSettingsDto;
__decorate([
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], UpdateSettingsDto.prototype, "settings", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], UpdateSettingsDto.prototype, "clears", void 0);
//# sourceMappingURL=settings.dto.js.map