"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerModule = void 0;
/**
 * 日志模块。
 *
 * `@Global()` 的原因：AppFileLogger 是全站唯一的日志出口（main.ts 把它
 * 挂给 app.useLogger，异常过滤器与各 service 都经由它），若不设为全局，
 * 每个业务模块都得重复 imports，那正是要消灭的样板。
 *
 * 它依赖 ConfigService，所以必须在 AppModule.imports 里排在 ConfigModule 之后。
 */
const common_1 = require("@nestjs/common");
const file_logger_1 = require("./file-logger");
let LoggerModule = class LoggerModule {
};
exports.LoggerModule = LoggerModule;
exports.LoggerModule = LoggerModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [file_logger_1.AppFileLogger],
        exports: [file_logger_1.AppFileLogger],
    })
], LoggerModule);
//# sourceMappingURL=logger.module.js.map