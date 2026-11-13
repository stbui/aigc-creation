import { describe, expect, it, vi } from 'vitest';

import {
  batchIndexOf,
  buildRows,
  buildVariantPlan,
  cellState,
  countGenerations,
  downloadFileName,
  ensureAssetsInProject,
  imageInputCountError,
  modelImageInputLimit,
  labelOf,
  rowKeyOf,
  variantCaption,
} from '../utils';
import type { GalleryItem, UploadedImage } from '../hooks';
import type { Asset } from '../api';
import type { PublicModelGroup } from '../../../lib/models';

/**
 * 商品主图「创作结果」归组与展示口径。
 *
 * 锁住四条不变量：
 *   1. 一次生成 = 一行，页签角标按批次计而不是按任务计；
 *   2. 批内顺序按 batchIndex，避免接口返回顺序变化导致套图错位；
 *   3. 图片标签优先使用任务 caption，再回落到变体名；
 *   4. 下载扩展名跟真实格式走。
 */

function item(over: Partial<GalleryItem> & { id: string }): GalleryItem {
  return {
    url: '',
    ...over,
  };
}

function mainImageModel(maxImages: number): PublicModelGroup {
  return {
    id: 'main_image:main-image',
    modelKey: 'main-image',
    name: '仿真图像·main_image',
    icon: '',
    description: '',
    capability: 'main_image',
    sortOrder: 0,
    displayPrice: 10,
    priceLabel: '10 积分',
    billingMode: 'fixed_request',
    capabilitySpec: {
      version: 1,
      capability: 'image',
      inputs: { image: { min: 1, max: maxImages } },
    },
    supplyCount: 1,
    available: true,
  };
}

describe('商品图输入上限', () => {
  it('读取模型能力合同里的图片上限', () => {
    expect(modelImageInputLimit(mainImageModel(4))).toBe(4);
  });

  it('5 张素材遇到最多 4 张的模型时给出明确提示，不静默截断', () => {
    expect(imageInputCountError(mainImageModel(4), 5)).toBe(
      '所选模型「仿真图像·main_image」最多支持 4 张商品图，请移除 1 张或切换模型',
    );
  });

  it('素材数未超过模型上限时不报错', () => {
    expect(imageInputCountError(mainImageModel(4), 4)).toBeNull();
  });
});

describe('variantCaption', () => {
  it('把主图变体转成中文标签', () => {
    expect(variantCaption({ variant: 'white_background' })).toBe('白底图');
    expect(variantCaption({ variant: 'scene' })).toBe('场景图');
  });

  it('未知变体原样显示，参数缺失时返回 undefined', () => {
    expect(variantCaption({ variant: 'custom' })).toBe('custom');
    expect(variantCaption({})).toBeUndefined();
  });
});

describe('cellState', () => {
  it('有图就是 ready', () => {
    expect(cellState(item({ id: 't1', url: '/uploads/a.png' }))).toBe('ready');
  });

  it('失败与取消都算 failed', () => {
    expect(cellState(item({ id: 't1', status: 'failed' }))).toBe('failed');
    expect(cellState(item({ id: 't1', status: 'cancelled' }))).toBe('failed');
  });

  it('排队与运行中算 pending', () => {
    expect(cellState(item({ id: 't1', status: 'queued' }))).toBe('pending');
    expect(cellState(item({ id: 't1', status: 'running' }))).toBe('pending');
  });
});

describe('batchIndexOf', () => {
  it('读取有效 batchIndex', () => {
    expect(batchIndexOf(item({ id: 't1', params: { batchIndex: 2 } }))).toBe(2);
  });

  it('缺字段的旧任务排到最后', () => {
    expect(batchIndexOf(item({ id: 't1' }))).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('labelOf', () => {
  it('优先使用任务 caption', () => {
    expect(
      labelOf(item({ id: 't1', caption: '主视觉', params: { variant: 'scene' } })),
    ).toBe('主视觉');
  });

  it('没有 caption 时回落中文变体名', () => {
    expect(labelOf(item({ id: 't1', params: { variant: 'selling_point' } }))).toBe('卖点图');
  });

  it('都没有时用「商品主图」兜底', () => {
    expect(labelOf(item({ id: 't1' }))).toBe('商品主图');
  });
});

describe('rowKeyOf / countGenerations', () => {
  it('同批次共享归组键', () => {
    const a = item({ id: 't1', params: { batchId: 'b1' } });
    const b = item({ id: 't2', params: { batchId: 'b1' } });
    expect(rowKeyOf(a)).toBe(rowKeyOf(b));
  });

  it('角标按生成次数计，不按任务数计', () => {
    const items = [
      item({ id: 't1', params: { batchId: 'b1' } }),
      item({ id: 't2', params: { batchId: 'b1' } }),
      item({ id: 't3', params: { batchId: 'b1' } }),
      item({ id: 't4', params: { batchId: 'b2' } }),
    ];
    expect(countGenerations(items)).toBe(2);
  });

  it('没有 batchId 的旧任务各自成行', () => {
    expect(countGenerations([item({ id: 't1' }), item({ id: 't2' })])).toBe(2);
  });
});

describe('buildRows', () => {
  it('按 batchId 归组并按 batchIndex 排序', () => {
    const rows = buildRows([
      item({ id: 't3', params: { batchId: 'b1', batchIndex: 3 } }),
      item({ id: 't1', params: { batchId: 'b1', batchIndex: 1 } }),
      item({ id: 't2', params: { batchId: 'b1', batchIndex: 2 } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((cell) => cell.id)).toEqual(['t1', 't2', 't3']);
  });

  it('保留同一批次提交的全部原图及原顺序，并带出商品名与提示词', () => {
    const inputUrls = [
      '/uploads/in-1.png',
      '/uploads/in-2.png',
      '/uploads/in-3.png',
      '/uploads/in-4.png',
      '/uploads/in-5.png',
    ];
    const rows = buildRows([
      item({
        id: 't1',
        url: '/uploads/out.png',
        inputUrls,
        params: {
          batchId: 'b1',
          productName: ' 轻奢沙发 ',
          description: ' 弧形设计 ',
        },
      }),
    ]);
    expect(rows[0].sourceUrls).toEqual(inputUrls);
    expect(rows[0].productName).toBe('轻奢沙发');
    expect(rows[0].prompt).toBe('弧形设计');
  });

  it('同批次多个任务共享输入时只保留一份完整原图，不按任务数重复', () => {
    const inputUrls = ['/uploads/in-1.png', '/uploads/in-2.png', '/uploads/in-3.png'];
    const rows = buildRows([
      item({ id: 't1', inputUrls, params: { batchId: 'b1', batchIndex: 1 } }),
      item({ id: 't2', inputUrls, params: { batchId: 'b1', batchIndex: 2 } }),
    ]);

    expect(rows[0].sourceUrls).toEqual(inputUrls);
  });

  it('历史任务缺少输入素材时原图为空数组', () => {
    const rows = buildRows([item({ id: 't1', url: '/uploads/out.png' })]);

    expect(rows[0].sourceUrls).toEqual([]);
  });

  it('批内还有生成中的格子时标记 pending', () => {
    const rows = buildRows([
      item({ id: 't1', url: '/uploads/a.png', params: { batchId: 'b1', batchIndex: 1 } }),
      item({ id: 't2', status: 'running', params: { batchId: 'b1', batchIndex: 2 } }),
    ]);
    expect(rows[0].pending).toBe(true);
  });

  it('全部到终态后不再 pending', () => {
    const rows = buildRows([
      item({ id: 't1', url: '/uploads/a.png', params: { batchId: 'b1' } }),
      item({ id: 't2', status: 'failed', params: { batchId: 'b1' } }),
    ]);
    expect(rows[0].pending).toBe(false);
  });
});

describe('downloadFileName', () => {
  it('扩展名跟真实格式走', () => {
    expect(
      downloadFileName(item({ id: 'abcdef123456', format: 'jpeg' })),
    ).toBe('main-image-商品主图-123456.jpeg');
  });

  it('带上变体名与前缀', () => {
    const name = downloadFileName(
      item({ id: 'abcdef123456', params: { variant: 'white_background' }, format: 'png' }),
      'product-kit',
    );
    expect(name).toBe('product-kit-白底图-123456.png');
  });
});


/**
 * 商品主图提交前必须把跨项目素材复制到当前项目：后端准入按
 * (ownerId, projectId) 校验 inputAssetIds，直接提交其他项目 id 会报
 * 「部分输入素材不存在或无权限」。
 */
function asset(over: Partial<Asset> & Pick<Asset, 'id' | 'projectId' | 'sourceUrl'>): Asset {
  return {
    ownerId: 'user-1',
    kind: 'original',
    format: 'image/png',
    sizeBytes: 10,
    createdAt: '2026-11-03T00:00:00.000Z',
    ...over,
  } as Asset;
}

function image(over: Partial<UploadedImage> & Pick<UploadedImage, 'id' | 'name' | 'url'>): UploadedImage {
  return { ...over };
}

describe('ensureAssetsInProject', () => {
  it('把其他项目素材复制到当前项目并使用新 asset id', async () => {
    const getAsset = vi.fn().mockResolvedValue(
      asset({
        id: 'asset-old',
        projectId: 'project-other',
        sourceUrl: '/uploads/old.png',
        signedUrl: 'http://localhost:4100/uploads/old.png',
      }),
    );
    const fetchAsset = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    });
    const uploadAsset = vi.fn().mockResolvedValue(
      asset({
        id: 'asset-copy',
        projectId: 'project-current',
        sourceUrl: '/uploads/copy.png',
        signedUrl: 'http://localhost:4100/uploads/copy.png',
      }),
    );
    const onPrepared = vi.fn();

    const result = await ensureAssetsInProject(
      [image({ id: 'asset-old', name: '主图.png', url: '/uploads/old.png', projectId: 'project-other' })],
      'project-current',
      { getAsset, fetchAsset, uploadAsset, onPrepared },
    );

    expect(getAsset).toHaveBeenCalledWith('asset-old');
    expect(fetchAsset).toHaveBeenCalledWith(expect.stringContaining('/uploads/old.png'));
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    const [file, targetProjectId] = uploadAsset.mock.calls[0] as [File, string];
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/png');
    expect(targetProjectId).toBe('project-current');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'asset-copy',
        projectId: 'project-current',
        name: '主图.png',
      }),
    ]);
    expect(onPrepared).toHaveBeenCalledWith('asset-old', result[0]);
  });

  it('同项目（含未携带 projectId 的手机素材）不复制，直接使用原 id', async () => {
    const getAsset = vi.fn().mockResolvedValue(
      asset({ id: 'asset-current', projectId: 'project-current', sourceUrl: '/uploads/current.png' }),
    );
    const fetchAsset = vi.fn();
    const uploadAsset = vi.fn();

    const result = await ensureAssetsInProject(
      [image({ id: 'asset-current', name: '手机图.jpg', url: '/uploads/current.png' })],
      'project-current',
      { getAsset, fetchAsset, uploadAsset },
    );

    expect(getAsset).toHaveBeenCalledWith('asset-current');
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(uploadAsset).not.toHaveBeenCalled();
    expect(result[0]).toEqual(
      expect.objectContaining({ id: 'asset-current', projectId: 'project-current' }),
    );
  });

  it('缓存显示同项目但素材已被移动时，按服务端归属复制到当前项目', async () => {
    const getAsset = vi.fn().mockResolvedValue(
      asset({
        id: 'asset-moved',
        projectId: 'project-other',
        sourceUrl: '/uploads/moved.png',
        signedUrl: 'http://localhost:4100/uploads/moved.png',
      }),
    );
    const fetchAsset = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    });
    const uploadAsset = vi.fn().mockResolvedValue(
      asset({
        id: 'asset-copy',
        projectId: 'project-current',
        sourceUrl: '/uploads/copy.png',
      }),
    );

    const result = await ensureAssetsInProject(
      [
        image({
          id: 'asset-moved',
          name: '已移动素材.png',
          url: '/uploads/moved.png',
          projectId: 'project-current',
        }),
      ],
      'project-current',
      { getAsset, fetchAsset, uploadAsset },
    );

    expect(getAsset).toHaveBeenCalledWith('asset-moved');
    expect(fetchAsset).toHaveBeenCalledWith(expect.stringContaining('/uploads/moved.png'));
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ id: 'asset-copy', projectId: 'project-current' }),
    );
  });

  it('缓存显示同项目但素材已失效时，提交前明确报错', async () => {
    const getAsset = vi.fn().mockRejectedValue(new Error('404'));
    const fetchAsset = vi.fn();
    const uploadAsset = vi.fn();

    await expect(
      ensureAssetsInProject(
        [
          image({
            id: 'asset-stale',
            name: '失效缓存.png',
            url: '/uploads/stale.png',
            projectId: 'project-current',
          }),
        ],
        'project-current',
        { getAsset, fetchAsset, uploadAsset },
      ),
    ).rejects.toThrow('素材「失效缓存.png」不存在或无权限，请重新选择');
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('跨项目复制失败时抛错，不回退提交原 asset id', async () => {
    const getAsset = vi.fn().mockResolvedValue(
      asset({
        id: 'asset-other',
        projectId: 'project-other',
        sourceUrl: '/uploads/other.png',
        signedUrl: 'http://localhost:4100/uploads/other.png',
      }),
    );
    const fetchAsset = vi.fn().mockRejectedValue(new Error('CORS blocked'));
    const uploadAsset = vi.fn();

    await expect(
      ensureAssetsInProject(
        [image({ id: 'asset-other', name: '旧项目图.png', url: '/uploads/other.png' })],
        'project-current',
        { getAsset, fetchAsset, uploadAsset },
      ),
    ).rejects.toThrow('素材「旧项目图.png」属于其他项目，复制失败，请稍后重试');
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('素材不存在或无权限时给出明确错误', async () => {
    const getAsset = vi.fn().mockRejectedValue(new Error('404'));
    const fetchAsset = vi.fn();
    const uploadAsset = vi.fn();

    await expect(
      ensureAssetsInProject(
        [image({ id: 'asset-missing', name: '失效素材.png', url: '/uploads/missing.png' })],
        'project-current',
        { getAsset, fetchAsset, uploadAsset },
      ),
    ).rejects.toThrow('素材「失效素材.png」不存在或无权限，请重新选择');
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(uploadAsset).not.toHaveBeenCalled();
  });
});

describe('buildVariantPlan', () => {
  it('按变体顺序展开计数，一类填几张就出现几次', () => {
    expect(
      buildVariantPlan({ white_background: 1, scene: 2, selling_point: 0, other: 3 }),
    ).toEqual([
      'white_background',
      'scene',
      'scene',
      'other',
      'other',
      'other',
    ]);
  });

  it('缺省或为 0 的变体不产生任务', () => {
    expect(buildVariantPlan({})).toEqual([]);
    expect(buildVariantPlan({ white_background: 0, scene: 0 })).toEqual([]);
  });
});
