"use strict";
/**
 * 任务素材边界 —— 输入素材物化与产出落盘。
 *
 * 移植自 open-ai-canvas `internal/app/task_media*.go` 与 `task_result_recovery.go`：
 *   · 输入：从存储层读出字节，按 `MediaReference` 交给协议层（协议只认
 *     `url` / `dataUrl`，永远拿不到本地路径）；
 *   · 产出：上游给的可能是公网地址或内联字节，先落成本地字节，再套 AIGC
 *     标识、写存储、登记 `Asset`。
 *
 * 两条不能颠倒的顺序：
 *   1. **标识在落存储之前** —— 未标识的产出绝不写进存储，用户拿到手就是一张
 *      没有标识的 AI 图；
 *   2. **素材登记在存储之后** —— 先写文件再建行，中途失败最多留下孤儿文件，
 *      不会出现「有记录没有文件」的破图。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var TaskMediaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskMediaService = void 0;
exports.extOfFormat = extOfFormat;
exports.readImageDims = readImageDims;
const common_1 = require("@nestjs/common");
const jimp_1 = require("jimp");
const prisma_service_1 = require("../../prisma/prisma.service");
const storage_service_1 = require("../../storage/storage.service");
const aigc_label_service_1 = require("../../aigc-label/aigc-label.service");
const aigc_label_1 = require("../../common/aigc-label");
const image_validation_1 = require("../../assets/image-validation");
const image_format_1 = require("../media/image-format");
const multi_fusion_1 = require("../../capabilities/definitions/multi_fusion");
const env_files_1 = require("../../config/env-files");
let TaskMediaService = TaskMediaService_1 = class TaskMediaService {
    constructor(prisma, storage, aigcLabel) {
        this.prisma = prisma;
        this.storage = storage;
        this.aigcLabel = aigcLabel;
        this.log = new common_1.Logger(TaskMediaService_1.name);
    }
    // ── 输入 ──────────────────────────────────────────────────────────
    /**
     * 输入素材 → 协议层素材列表（保持提交顺序）。
     *
     * 顺序是语义的一部分：爆款复刻约定 `[0]=商品图`、`[1]=参考图`，
     * Prisma 的 `in` 查询不保证顺序，必须按 id 原序重排。
     */
    async inputReferences(inputAssetIds, options = {}) {
        const assets = await this.prisma.asset.findMany({ where: { id: { in: inputAssetIds } } });
        const byId = new Map(assets.map((asset) => [asset.id, asset]));
        const references = [];
        for (const [index, id] of inputAssetIds.entries()) {
            const asset = byId.get(id);
            if (!asset)
                throw new Error(`输入素材不存在: ${id}`);
            const buffer = await this.readAssetBytes(asset);
            references.push(await this.toReference(buffer, asset.format, {
                id: asset.id,
                order: index,
                name: `${asset.id}${extOfFormat(asset.format)}`,
                absoluteBaseUrl: options.absoluteBaseUrl,
                sourceUrl: asset.sourceUrl,
            }));
        }
        return references;
    }
    /**
     * 遮罩素材 → 协议层素材。
     *
     * 协议层没有「遮罩」这个通用概念（参考实现里只有特定协议通过
     * `providerOptions` 消费遮罩），因此这里只负责**读出来并校验**：
     *   · 必须属于本人且是上传素材；
     *   · 必须是 PNG、尺寸与原图一致、确实有可编辑区域（透明像素）。
     *
     * 校验失败直接抛错 —— 静默退化成「无遮罩」会把「只改涂抹区域」
     * 变成「整图重绘」，用户付了积分拿到一张面目全非的图。
     */
    async maskReference(maskAssetId, ownerId, sourceAsset) {
        const id = typeof maskAssetId === 'string' ? maskAssetId.trim() : '';
        if (!id)
            return null;
        const asset = await this.prisma.asset.findFirst({
            where: { id, ownerId, kind: 'original' },
            select: { id: true, sourceUrl: true, storageKey: true, storageBackend: true, format: true },
        });
        if (!asset)
            throw new Error('遮罩素材不存在或无权限');
        if (asset.format && asset.format !== 'image/png')
            throw new Error('遮罩必须使用 PNG 格式');
        if (!sourceAsset)
            throw new Error('应用遮罩时缺少原图素材');
        const sourceBuffer = await this.readAssetBytes(sourceAsset);
        const sourceInfo = (0, image_validation_1.inspectUploadedImage)(sourceBuffer);
        const buffer = await this.readAssetBytes(asset);
        (0, image_validation_1.inspectMaskImage)(buffer, { width: sourceInfo.width, height: sourceInfo.height });
        // 遮罩以透明像素表示「要修改的区域」；全不透明等于没有可编辑区域
        const image = await jimp_1.Jimp.read(buffer);
        let transparent = 0;
        const data = image.bitmap.data;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] < 250)
                transparent += 1;
        }
        if (transparent === 0)
            throw new Error('遮罩没有任何透明区域，无法确定重绘范围');
        return {
            id: asset.id,
            kind: 'mask',
            role: 'mask',
            mimeType: 'image/png',
            name: `mask-${asset.id}.png`,
            dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        };
    }
    // ── 产出 ──────────────────────────────────────────────────────────
    /**
     * 产出字节 → AIGC 标识 → 存储 → `Asset`。
     *
     * 可见角标合成失败（`AigcVisibleLabelError`）向上抛：调用方据此把任务判失败
     * 并退款（fail-closed）。隐式元数据失败只告警 —— 可见角标还在，交付不阻断。
     */
    async persist(task, outputs) {
        if (outputs.length === 0)
            throw new Error('生成结果为空');
        const storage = this.storage.getActive();
        const stored = [];
        const isVideo = String(outputs[0].format).startsWith('video/');
        for (const output of outputs) {
            let buffer = output.buffer;
            let format = output.format;
            let aigcMeta;
            let labeledAt = null;
            if (isVideo) {
                aigcMeta = {
                    labeled: false,
                    metadata: false,
                    visible: false,
                    method: 'api-only',
                    warning: '视频未写入内嵌标识（本机无 ffmpeg）：标识仅存在于接口字段与播放器角标',
                };
            }
            else {
                const visible = await this.aigcLabel.runtime();
                const labeled = await (0, aigc_label_1.labelGeneratedImage)(buffer, format, {
                    capability: task.capability,
                    taskId: task.id,
                    createdAt: new Date(),
                    visible: { spec: visible.spec, badgePng: visible.badgePng },
                });
                buffer = labeled.buffer;
                format = labeled.format;
                aigcMeta = labeled.meta;
                labeledAt = new Date();
                if (!aigcMeta.metadata) {
                    this.log.warn(`AIGC 隐式标识未写入 task=${task.id}: ${aigcMeta.warning ?? 'unknown'}`);
                }
                else if (!aigcMeta.visible) {
                    this.log.warn(`AIGC 可见角标已关闭, 仅写入隐式标识 task=${task.id}`);
                }
            }
            const ext = extOfFormat(format);
            const key = this.storage.buildKey('generated', ext);
            const written = await storage.put(key, buffer, format);
            const url = await storage.url(key);
            const dims = isVideo ? { width: null, height: null } : await readImageDims(buffer);
            const asset = await this.prisma.asset.create({
                data: {
                    projectId: task.projectId,
                    ownerId: task.ownerId,
                    kind: 'generated',
                    capability: task.capability,
                    sourceUrl: url,
                    width: dims.width,
                    height: dims.height,
                    format,
                    sizeBytes: written.sizeBytes,
                    durationMs: output.durationMs,
                    storageBackend: storage.backend,
                    storageKey: key,
                    aigcMeta: JSON.stringify(aigcMeta),
                    aigcLabeledAt: labeledAt,
                },
            });
            stored.push({ assetId: asset.id, buffer, format, aigcMeta });
        }
        return stored;
    }
    /** AIGC 角标合成失败的错误类型再导出，避免调用方直接依赖 common 层 */
    static isLabelError(error) {
        return error instanceof aigc_label_1.AigcVisibleLabelError;
    }
    // ── 工具 ──────────────────────────────────────────────────────────
    /**
     * 上游素材 → 协议层引用。
     *
     * 默认内联成 data URL：本地开发环境没有公网地址，把内网 URL 发给上游必然
     * 抓不到。只有协议显式要求公网地址（`requiresPublicMediaUrls`）时才用素材地址，
     * 由调用方保证该地址对外可达。
     */
    async toReference(buffer, format, options = {}) {
        const mimeType = String(format ?? '').trim() || (0, image_format_1.detectImageFormat)(buffer) || 'application/octet-stream';
        const base = {
            id: options.id,
            order: options.order,
            name: options.name,
            role: options.role,
            kind: options.kind,
            mimeType,
        };
        if (options.preferUrl && options.sourceUrl && options.absoluteBaseUrl) {
            return { ...base, url: `${options.absoluteBaseUrl}${options.sourceUrl}` };
        }
        return { ...base, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` };
    }
    /** 按素材记录的后端读取字节（存量数据可能没有 storageKey） */
    async readAssetBytes(asset) {
        const backend = asset.storageBackend ?? 'local';
        const provider = this.storage.get(backend);
        const key = asset.storageKey ?? asset.sourceUrl.replace(/^\/uploads\//, '');
        if (provider && (await provider.exists(key))) {
            return provider.get(key);
        }
        const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const { join } = await Promise.resolve().then(() => __importStar(require('path')));
        return readFile(join((0, env_files_1.resolveUploadsDir)(), key));
    }
    /**
     * 多图融合的档位对齐：模型偶发返回低于所选档位的尺寸属静默降级。
     * 仅处理 Jimp 可安全重编码的 PNG/JPEG；比例偏差较大时先居中等比裁切，
     * 避免把主体拉扁。
     */
    async normalizeFusionOutput(buffer, format, ratio, size) {
        if (format !== 'image/png' && format !== 'image/jpeg')
            return { buffer, format };
        const target = (0, multi_fusion_1.multiFusionOutputDimensions)(ratio, size);
        if (!target)
            return { buffer, format };
        const image = await jimp_1.Jimp.read(buffer);
        if (image.bitmap.width === target.width && image.bitmap.height === target.height) {
            return { buffer, format };
        }
        const sourceRatio = image.bitmap.width / image.bitmap.height;
        const targetRatio = target.width / target.height;
        if (Math.abs(sourceRatio - targetRatio) > 0.01) {
            image.cover({ w: target.width, h: target.height });
        }
        else {
            image.resize({ w: target.width, h: target.height });
        }
        return {
            buffer: await image.getBuffer(format === 'image/jpeg' ? jimp_1.JimpMime.jpeg : jimp_1.JimpMime.png),
            format,
        };
    }
};
exports.TaskMediaService = TaskMediaService;
exports.TaskMediaService = TaskMediaService = TaskMediaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        storage_service_1.StorageService,
        aigc_label_service_1.AigcLabelService])
], TaskMediaService);
/** mime → 存储扩展名；未知 mime 回落 jpg（与既有素材一致） */
function extOfFormat(format) {
    const sub = String(format ?? '').split(';')[0].trim().toLowerCase();
    switch (sub) {
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'video/mp4':
            return 'mp4';
        case 'video/webm':
            return 'webm';
        case 'video/x-msvideo':
            return 'avi';
        default:
            return 'jpg';
    }
}
/** 读图片宽高；视频不碰 Jimp（喂 mp4 会抛 Unsupported MIME type） */
async function readImageDims(buffer) {
    const image = await jimp_1.Jimp.read(buffer);
    return { width: image.bitmap.width, height: image.bitmap.height };
}
//# sourceMappingURL=task-media.service.js.map