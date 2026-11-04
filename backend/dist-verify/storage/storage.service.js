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
var StorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskSecret = exports.StorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const path_1 = require("path");
const storage_provider_1 = require("./storage.provider");
Object.defineProperty(exports, "maskSecret", { enumerable: true, get: function () { return storage_provider_1.maskSecret; } });
/**
 * 存储工厂。
 *
 * 后端选择优先级:
 *   STORAGE_BACKEND 环境变量 > 缺省local
 *
 * 配置自检在启动时跑一遍并打WARN —— 配错了要在启动日志里就能看到,
 * 而不是等到用户上传失败才发现。
 */
let StorageService = StorageService_1 = class StorageService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(StorageService_1.name);
        this.providers = new Map();
        this.active = 'local';
        this.active = process.env.STORAGE_BACKEND || 'local';
        // 本地根目录取自 UPLOAD_DIR: 三环境必须各写各的目录, 否则 test 跑一次
        // 「删除任务」就会连带删掉开发环境正在用的素材图, 且不留任何痕迹。
        this.register(new storage_provider_1.LocalStorageProvider(this.resolveUploadsDir()));
        // 按需构造: 只有配了对应环境变量才实例化, 未配则不进 map。
        // 这样 require('ali-oss') / require('minio') 根本不会执行 —— 本地开发零云依赖。
        if (process.env.OSS_REGION && process.env.OSS_BUCKET && process.env.OSS_ACCESS_KEY_ID) {
            try {
                this.register(new storage_provider_1.OssStorageProvider({
                    region: process.env.OSS_REGION,
                    bucket: process.env.OSS_BUCKET,
                    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
                    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
                    endpoint: process.env.OSS_ENDPOINT,
                }));
            }
            catch (e) {
                this.logger.error(`OSS 初始化失败(将被忽略): ${e.message}`);
            }
        }
        if (process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY) {
            try {
                this.register(new storage_provider_1.MinioStorageProvider({
                    endPoint: process.env.MINIO_ENDPOINT,
                    port: Number(process.env.MINIO_PORT ?? 9000),
                    useSSL: process.env.MINIO_USE_SSL === 'true',
                    accessKey: process.env.MINIO_ACCESS_KEY,
                    secretKey: process.env.MINIO_SECRET_KEY ?? '',
                    bucket: process.env.MINIO_BUCKET ?? 'huojue',
                }));
            }
            catch (e) {
                this.logger.error(`MinIO 初始化失败(将被忽略): ${e.message}`);
            }
        }
    }
    async onModuleInit() {
        /*
         * 配置的后端没起来 (例如 STORAGE_BACKEND=oss 但 ali-oss 未安装) 时**不回落本地**:
         * 那会让生产数据静默写进容器本地盘, 重启即丢, 而日志只有一行 WARN。
         * 这里保留启动 (健康检查与后台要能报出原因), 但每次读写都走 getActive() 的硬失败。
         */
        if (!this.providers.has(this.active)) {
            this.logger.error(`存储后端 ${this.active} 未就绪（SDK 未安装或凭据缺失），上传/读取将直接失败而不是写入本地盘`);
            return;
        }
        const active = this.getActive();
        const probe = await active.probe();
        if (probe.ok) {
            this.logger.log(`存储后端 ${this.active} 就绪: ${probe.message}${probe.latencyMs ? ` (${probe.latencyMs}ms)` : ''}`);
        }
        else {
            this.logger.warn(`存储后端 ${this.active} 不可用: ${probe.message}`);
        }
        const missing = storage_provider_1.STORAGE_BACKENDS.filter((backend) => backend !== 'local' && !this.providers.has(backend));
        if (missing.length > 0) {
            this.logger.log(`未启用的后端: ${missing.join(', ')} (补齐对应环境变量即可启用)`);
        }
    }
    register(p) {
        this.providers.set(p.backend, p);
    }
    /** 上传根目录: 配置层优先, 未配置时回落 process.env.UPLOAD_DIR, 最后 'uploads' */
    resolveUploadsDir() {
        const raw = this.config.get('path.uploads') ?? process.env.UPLOAD_DIR ?? 'uploads';
        return (0, path_1.resolve)(process.cwd(), raw);
    }
    /**
     * 当前默认后端的 provider。
     *
     * 配置的后端不可用时**显式抛错**, 不再静默回落 local —— 回落会把
     * 「配置写错」变成「文件悄悄写进容器本地盘」, 且没有任何调用方知道。
     * 本地后端的回落只保留在 active 本来就是 local 的情况。
     */
    getActive() {
        const provider = this.providers.get(this.active);
        if (provider)
            return provider;
        if (this.active === 'local')
            return this.providers.get('local');
        throw new Error(`存储后端 ${this.active} 未就绪: SDK 未安装或凭据缺失。` +
            `请补齐依赖/环境变量, 或将 STORAGE_BACKEND 改回 local（已拒绝静默回落本地盘）`);
    }
    get activeBackend() {
        return this.active;
    }
    /**
     * 按后端取provider。
     *
     * 素材记录里存了 storageBackend, 读取时必须用**当时写入的那个后端**,
     * 否则切换默认后端后老素材全部读不到。
     */
    get(backend) {
        return this.providers.get(backend) ?? null;
    }
    /**
     * 各后端状态, 供后台 B-62/B-63 展示。
     *
     * 返回**全部候选后端**而非仅已注册的: 未配置的 OSS/MinIO 也要出现在
     * 列表里 (configured=false), 否则运营在界面上看不到它们存在,
     * 也就无从得知「补哪些环境变量就能启用」。缺失信息比多余信息更致命。
     */
    async status() {
        const out = [];
        for (const backend of storage_provider_1.STORAGE_BACKENDS) {
            const p = this.providers.get(backend);
            if (!p) {
                out.push({
                    backend,
                    available: false,
                    configured: false,
                    active: backend === this.active,
                });
                continue;
            }
            const probe = await p.probe();
            const cred = p.credentialStatus();
            out.push({
                backend,
                available: probe.ok,
                configured: cred.configured,
                active: backend === this.active,
                masked: cred.masked,
                endpoint: cred.endpoint,
                probeMessage: probe.message,
                probeLatencyMs: probe.latencyMs,
            });
        }
        return out;
    }
    /** 切换默认后端 (运行时; 不影响已写入素材的读取) */
    setActive(backend) {
        if (!this.providers.has(backend)) {
            throw new Error(`后端未启用: ${backend}`);
        }
        this.active = backend;
        this.logger.warn(`默认存储后端已切换为 ${backend} (已写入的素材仍按原后端读取)`);
    }
    /**
     * 生成存储 key。
     *
     * 格式 `<类别>/<yyyymm>/<随机>.<ext>` —— 按月分目录避免单目录文件过多,
     * 随机名避免同名覆盖。
     */
    buildKey(category, ext) {
        const d = new Date();
        const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
        const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        return `${category}/${ym}/${rand}.${ext}`;
    }
};
exports.StorageService = StorageService;
exports.StorageService = StorageService = StorageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], StorageService);
//# sourceMappingURL=storage.service.js.map