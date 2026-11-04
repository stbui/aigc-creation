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
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const config_1 = require("@nestjs/config");
const node_sqlite_adapter_1 = require("./node-sqlite-adapter");
// Prisma 7 breaking change: datasource url 不再写在 schema.prisma,
// 必须通过 driver adapter 传给 PrismaClient 构造函数。
// 这里用基于 node:sqlite 自研的 adapter, 避免 better-sqlite3 / libsql 的原生编译依赖。
// 详见 https://pris.ly/d/prisma7-client-config
//
// 库路径来自配置层的 DATABASE_URL (db.url), 不再硬编码 'file:./dev.db':
// 「三环境各连各的库」是环境隔离的前提, 硬编码等于把开发库钉成唯一真相。
// 兜底值 'file:./dev.db' 与迁移前逐字一致 —— 未配置 DATABASE_URL 时行为完全不变。
let PrismaService = class PrismaService extends client_1.PrismaClient {
    constructor(config) {
        super({
            adapter: new node_sqlite_adapter_1.NodeSQLiteDriverAdapterFactory({ url: config.get('db.url') ?? 'file:./dev.db' }),
        });
    }
    async onModuleInit() {
        await this.$connect();
    }
    async onModuleDestroy() {
        await this.$disconnect();
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map