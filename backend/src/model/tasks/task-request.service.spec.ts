import { describe, expect, it, vi } from 'vitest';

import { TaskRequestService } from './task-request.service';

/**
 * 任务执行请求必须按线路合同重建。
 *
 * 多图融合的产品合同可以只声明输入范围（由平台提供变体数参数），但线路合同
 * 明确声明了 `count -> imageCount`。执行时若拿产品合同裁剪意图，`count` 会被
 * 静默丢掉，上游只生成默认的 1 张。
 */
describe('TaskRequestService 线路参数投影', () => {
  it('保留线路声明、但产品合同未重复声明的变体数量', async () => {
    const productSpec = {
      version: 1,
      capability: 'image',
      operations: [],
      inputs: { image: { min: 2, max: 4 } },
      options: {},
      imageParameters: [],
    };
    const routeSpec = {
      version: 1,
      capability: 'image',
      operations: ['image_to_image'],
      inputs: { image: { min: 2, max: 4 } },
      options: {
        count: { min: 1, max: 4, step: 1 },
      },
      imageParameters: [
        {
          name: 'count',
          label: '生成数量',
          type: 'integer',
          binding: 'imageCount',
          min: 1,
          max: 4,
          step: 1,
          default: 1,
        },
      ],
    };
    const router = {
      findModel: vi.fn().mockResolvedValue({
        id: 'model-gpt-image-2',
        productSpec,
      }),
    };
    const catalog = {
      findRoute: vi.fn().mockResolvedValue({
        id: 'route-openai-images',
        channelModel: {
          capabilitySpec: routeSpec,
        },
      }),
    };
    const media = {
      inputReferences: vi.fn().mockResolvedValue([
        { id: 'asset-subject', url: 'https://example.test/subject.png', order: 0 },
        { id: 'asset-accent', url: 'https://example.test/accent.png', order: 1 },
      ]),
    };
    const service = new TaskRequestService(
      {} as never,
      router as never,
      catalog as never,
      media as never,
    );

    const built = await service.build({
      taskId: 'task-1',
      ownerId: 'user-1',
      capability: 'multi_fusion',
      params: { scene: 'print_pattern', variantCount: '4', ratio: '1:1', size: '1k' },
      inputAssetIds: ['asset-subject', 'asset-accent'],
      logicalModelId: 'model-gpt-image-2',
      routeId: 'route-openai-images',
      providerModelKey: 'gpt-image-2',
    });

    expect(built.intent.options?.count).toBe(4);
    expect(built.request.imageParameters?.count).toBe(4);
    expect(built.request.imageCount).toBe(4);
  });

  it('把页面比例按线路预设换成上游像素尺寸', async () => {
    const productSpec = {
      version: 1,
      capability: 'image',
      operations: [],
      inputs: { image: { min: 1, max: 4 } },
      options: {},
      imageParameters: [],
    };
    const routeSpec = {
      version: 1,
      capability: 'image',
      operations: ['image_to_image'],
      inputs: { image: { min: 1, max: 4 } },
      options: {
        size: { values: ['*'] },
      },
      imageParameters: [
        {
          name: 'size',
          label: '画幅 / 尺寸',
          type: 'string',
          binding: 'aspectRatio',
          encoding: 'pixels',
        },
      ],
      imageSize: {
        parameter: 'size',
        allowCustom: true,
        presets: [
          {
            ratio: '3:4',
            size: '1024x1360',
            width: 1024,
            height: 1360,
            tier: '1k',
          },
        ],
      },
    };
    const router = {
      findModel: vi.fn().mockResolvedValue({
        id: 'model-detail-image',
        productSpec,
      }),
    };
    const catalog = {
      findRoute: vi.fn().mockResolvedValue({
        id: 'route-openai-images',
        channelModel: {
          capabilitySpec: routeSpec,
        },
      }),
    };
    const media = {
      inputReferences: vi.fn().mockResolvedValue([
        { id: 'asset-product', url: 'https://example.test/product.png', order: 0 },
      ]),
    };
    const service = new TaskRequestService(
      {} as never,
      router as never,
      catalog as never,
      media as never,
    );

    const built = await service.build({
      taskId: 'task-detail-1',
      ownerId: 'user-1',
      capability: 'detail_image',
      params: {
        section: 'hero',
        productName: '测试商品',
        description: '测试商品描述',
        ratio: '3:4',
        size: '1k',
      },
      inputAssetIds: ['asset-product'],
      logicalModelId: 'model-detail-image',
      routeId: 'route-openai-images',
      providerModelKey: 'gpt-image-2',
    });

    expect(built.intent.options?.size).toBe('1024x1360');
    expect(built.request.imageParameters?.size).toBe('1024x1360');
    expect(built.request.aspectRatio).toBe('1024x1360');
  });
});
