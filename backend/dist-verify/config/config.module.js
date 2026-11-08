"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigModule = void 0;
/**
 * 全局配置模块。
 *
 * 装配顺序为什么是「唯一要点」：
 *   AppModule.imports 的**第一项**必须是 ConfigModule。因为 `isGlobal: true`
 *   的模块只在被 import 的那一刻完成注册，它导出的 ConfigService 才是全局的；
 *   排在后面的模块（含 LoggerModule）才能安全注入 ConfigService。
 *   换句话说顺序错了不会立刻报错，而是运行期注入到 undefined —— 最难查的一类。
 *
 * envFilePath 的优先级：数组**靠前**的文件优先（同 .env.test.local > .env.test）。
 * 具体档位由 env-files.ts 按 NODE_ENV 决定，test/production 刻意不回落 `.env`
 * （否则会继承开发库的 DATABASE_URL，见该文件顶部说明）。
 * 所有文件都允许缺失，此时完全依赖外部环境变量（容器部署的常态）。
 */
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const env_files_1 = require("./env-files");
const env_validation_1 = require("./env.validation");
let ConfigModule = class ConfigModule {
};
exports.ConfigModule = ConfigModule;
exports.ConfigModule = ConfigModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                cache: true,
                // .env 里可写 ASSET_PUBLIC_BASE=http://api.example.com:${PORT} 这类引用
                expandVariables: true,
                envFilePath: (0, env_files_1.resolveEnvFiles)(process.env.NODE_ENV),
                ignoreEnvFile: false,
                validate: env_validation_1.validateEnv,
            }),
        ],
        exports: [config_1.ConfigModule],
    })
], ConfigModule);
//# sourceMappingURL=config.module.js.map