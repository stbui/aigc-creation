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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getCapability } from '../../capabilities/capability.registry';
import { resolveImageParameterValues } from '../intent/image-contract';
import { restrictIntentToSpec } from '../intent/model-intent';
import type { ModelRequestIntent } from '../intent/spec-types';
import type { GenerationRequest, MediaReference } from '../protocol/runtime';
import type { ManifestCapability } from '../protocol/types';
import type { CachedLogicalRoute } from '../routing/routing.types';
import { RouterService } from '../routing/router.service';
import { RouteCatalogService } from '../catalog/route-catalog.service';
import { TaskMediaService } from './task-media.service';

/** 执行一个任务所需的上下文 */
export interface TaskExecutionContext {
  taskId: string;
  ownerId: string;
  capability: string;
  params: Record<string, any>;
  inputAssetIds: string[];
  logicalModelId: string;
  routeId: string;
  /** 渠道模型对外模型键（发给上游） */
  providerModelKey: string;
}

/** 构建结果：请求 + 本次线路的能力合同 + 归一后的意图 */
export interface BuiltTaskRequest {
  request: GenerationRequest;
  route: CachedLogicalRoute;
  intent: ModelRequestIntent;
  mask: MediaReference | null;
}

@Injectable()
export class TaskRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: RouterService,
    private readonly catalog: RouteCatalogService,
    private readonly media: TaskMediaService,
  ) {}

  /**
   * 构建一次派发所需的请求。
   *
   * 失败时抛出可读原因：参数不合法说明准入阶段漏了校验（属于 bug），
   * 素材缺失说明用户中途删了素材（按生成失败处理）。
   */
  async build(context: TaskExecutionContext): Promise<BuiltTaskRequest> {
    const def = getCapability(context.capability);
    if (!def) throw new Error(`能力不存在：${context.capability}`);
    const model = await this.router.findModel(context.logicalModelId);
    if (!model) throw new Error('前台模型已下线，无法继续执行该任务');
    const route = await this.catalog.findRoute(context.routeId);
    if (!route) throw new Error('任务选中的线路已不存在');

    const intent = restrictIntentToSpec(
      model.productSpec,
      def.model.intent(context.params, {
        image: context.inputAssetIds.length,
        video: 0,
      }),
    );

    const spec = route.channelModel.capabilitySpec;
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
      ? resolveImageParameterValues(spec.imageParameters, options)
      : undefined;

    const request: GenerationRequest = {
      capability: def.modality as ManifestCapability,
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
  maskAssetId(params: Record<string, any>): string {
    const raw = params?.modelGuideAssetId ?? params?.maskAssetId;
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private async buildMask(
    context: TaskExecutionContext,
    sourceImage: MediaReference | undefined,
  ): Promise<MediaReference | null> {
    const maskId = this.maskAssetId(context.params);
    if (!maskId) return null;
    const source = await this.prisma.asset.findFirst({
      where: { id: context.inputAssetIds[0] ?? '', ownerId: context.ownerId },
      select: { id: true, format: true, sourceUrl: true, storageKey: true, storageBackend: true },
    });
    const mask = await this.media.maskReference(maskId, context.ownerId, source ?? undefined);
    if (!mask) return null;
    // 保持 `sourceImage` 参数用于未来按原图尺寸做遮罩裁切；当前校验已在 maskReference 内完成
    void sourceImage;
    return mask;
  }
}

function stringOption(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}
