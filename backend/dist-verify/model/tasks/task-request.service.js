"use strict";
/**
 * 任务快照 → 生成请求。
 *
 * 移植自 open-ai-canvas `internal/app/task_route_executor.go` 的
 * `buildProviderRequest`：任务只存**用户参数**与供应侧快照，执行时按当时的
 * 能力合同重新投影成 `GenerationRequest`。
 *
 * 为什么不在建任务时把请求整体落库：能力合同、图片参数绑定都会随模型 revision
 * 变化，落一份旧请求等于把过去的字段布局冻结到未来。快照里只记
 * `logicalModelId / revisionId / routeId`，执行时按当前合同重建 —— 但重建结果
 * 必须来自**同一条线路的合同**（`route.channelModel.capabilitySpec`），
 * 否则「选路匹配的参数」与「发给上游的参数」会分叉。
 */
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
exports.TaskRequestService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const capability_registry_1 = require("../../capabilities/capability.registry");
const image_contract_1 = require("../intent/image-contract");
const model_intent_1 = require("../intent/model-intent");
const router_service_1 = require("../routing/router.service");
const route_catalog_service_1 = require("../catalog/route-catalog.service");
const task_media_service_1 = require("./task-media.service");
let TaskRequestService = class TaskRequestService {
    constructor(prisma, router, catalog, media) {
        this.prisma = prisma;
        this.router = router;
        this.catalog = catalog;
        this.media = media;
    }
    /**
     * 构建一次派发所需的请求。
     *
     * 失败时抛出可读原因：参数不合法说明准入阶段漏了校验（属于 bug），
     * 素材缺失说明用户中途删了素材（按生成失败处理）。
     */
    async build(context) {
        const def = (0, capability_registry_1.getCapability)(context.capability);
        if (!def)
            throw new Error(`能力不存在：${context.capability}`);
        const model = await this.router.findModel(context.logicalModelId);
        if (!model)
            throw new Error('前台模型已下线，无法继续执行该任务');
        const route = await this.catalog.findRoute(context.routeId);
        if (!route)
            throw new Error('任务选中的线路已不存在');
        const spec = route.channelModel.capabilitySpec;
        // 执行请求必须按**已选线路**的能力合同投影。产品合同只描述前台承诺的可选
        // 范围，可能不重复声明线路参数（如多图融合的 count）；拿它裁剪会让线路
        // 明明支持 4 张，实际请求却退回上游默认 1 张。
        const intent = (0, model_intent_1.restrictIntentToSpec)(spec, def.model.intent(context.params, {
            image: context.inputAssetIds.length,
            video: 0,
        }));
        if (spec.inputs?.mask === undefined && this.maskAssetId(context.params) !== '') {
            throw new Error('当前线路不支持遮罩重绘');
        }
        const images = await this.media.inputReferences(context.inputAssetIds);
        const mask = await this.buildMask(context, images[0]);
        // 遮罩与输入图一起进 `images`：协议清单按 `media.role === 'mask'` 过滤
        // （见 plugins/a6api 的 edits 分支），单独放 `inputs` 会被编辑端点漏掉
        const allImages = mask ? [...images, mask] : images;
        const options = intent.options ?? {};
        const imageParameters = spec.imageParameters
            ? (0, image_contract_1.resolveImageParameterValues)(spec.imageParameters, options)
            : undefined;
        const request = {
            capability: def.modality,
            model: context.providerModelKey,
            prompt: def.buildPrompt(context.params, context.inputAssetIds.length),
            images: allImages,
            inputs: allImages,
            operation: intent.operation,
            imageParameters,
            aspectRatio: stringOption(options.aspectRatio) || stringOption(options.size),
            resolution: stringOption(options.resolution) || stringOption(options.imageResolution),
            quality: stringOption(options.quality),
            imageCount: numberOption(options.count) ?? numberOption(options.imageCount),
            duration: numberOption(options.videoSeconds) ?? numberOption(options.duration),
            generateAudio: booleanOption(options.videoGenerateAudio),
            watermark: booleanOption(options.watermark),
            extra: {
                ...(mask ? { mask } : {}),
                // 意图原样透出：协议模板可以用 `request.extra.intentOptions.<key>`
                // 取用宿主不认识、但该线路声明过的参数
                intentOptions: options,
            },
        };
        return { request, route, intent, mask: mask ?? null };
    }
    /** 遮罩素材 id（局部重绘沿用 `modelGuideAssetId`，通用入口是 `maskAssetId`） */
    maskAssetId(params) {
        const raw = params?.modelGuideAssetId ?? params?.maskAssetId;
        return typeof raw === 'string' ? raw.trim() : '';
    }
    async buildMask(context, sourceImage) {
        const maskId = this.maskAssetId(context.params);
        if (!maskId)
            return null;
        const source = await this.prisma.asset.findFirst({
            where: { id: context.inputAssetIds[0] ?? '', ownerId: context.ownerId },
            select: { id: true, format: true, sourceUrl: true, storageKey: true, storageBackend: true },
        });
        const mask = await this.media.maskReference(maskId, context.ownerId, source ?? undefined);
        if (!mask)
            return null;
        // 保持 `sourceImage` 参数用于未来按原图尺寸做遮罩裁切；当前校验已在 maskReference 内完成
        void sourceImage;
        return mask;
    }
};
exports.TaskRequestService = TaskRequestService;
exports.TaskRequestService = TaskRequestService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        router_service_1.RouterService,
        route_catalog_service_1.RouteCatalogService,
        task_media_service_1.TaskMediaService])
], TaskRequestService);
function stringOption(value) {
    if (value === undefined || value === null)
        return '';
    return String(value).trim();
}
function numberOption(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function booleanOption(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value === 'boolean')
        return value;
    const text = String(value).trim().toLowerCase();
    if (text === 'true')
        return true;
    if (text === 'false')
        return false;
    return undefined;
}
//# sourceMappingURL=task-request.service.js.map