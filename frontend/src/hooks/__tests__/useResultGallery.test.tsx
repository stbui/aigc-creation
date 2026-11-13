import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPageMock } = vi.hoisted(() => ({ listPageMock: vi.fn() }));

vi.mock('../../lib/api', () => ({
  assetSrc: (asset?: { signedUrl?: string | null; sourceUrl?: string | null } | null) =>
    asset?.signedUrl || asset?.sourceUrl,
  generateApi: { listPage: listPageMock },
}));

import { useResultGallery } from '../useResultGallery';

beforeEach(() => {
  listPageMock.mockReset();
});

describe('useResultGallery', () => {
  it('保留任务的全部输入素材及原顺序，不只取首张', async () => {
    listPageMock.mockResolvedValue({
      items: [
        {
          id: 'task-1',
          capability: 'main_image',
          status: 'succeeded',
          params: {},
          inputAssets: [
            { id: 'in-1', sourceUrl: '/uploads/in-1.png' },
            { id: 'in-2', sourceUrl: '/uploads/in-2.png' },
            { id: 'in-3', sourceUrl: '/uploads/in-3.png' },
            { id: 'in-4', sourceUrl: '/uploads/in-4.png' },
            { id: 'in-5', sourceUrl: '/uploads/in-5.png' },
          ],
          outputAsset: { id: 'out-1', sourceUrl: '/uploads/out.png' },
        },
      ],
    });

    const { result } = renderHook(() =>
      useResultGallery({ capability: 'main_image', token: 'test-token' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items[0]?.inputUrls).toEqual([
      '/uploads/in-1.png',
      '/uploads/in-2.png',
      '/uploads/in-3.png',
      '/uploads/in-4.png',
      '/uploads/in-5.png',
    ]);
  });

  it('任务成功但产出地址缺失时保留失败格，不静默丢弃模块', async () => {
    listPageMock.mockResolvedValue({
      items: [
        {
          id: 'task-2',
          capability: 'detail_image',
          status: 'succeeded',
          params: {
            batchId: 'batch-1',
            batchIndex: 2,
            batchSize: 3,
            sectionLabel: '核心卖点图',
          },
          inputAssets: [],
          outputAsset: null,
        },
      ],
    });

    const { result } = renderHook(() =>
      useResultGallery({
        capability: 'detail_image',
        token: 'test-token',
        includeFailed: true,
        captionOf: (params) =>
          typeof params.sectionLabel === 'string' ? params.sectionLabel : undefined,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      id: 'task-2',
      status: 'failed',
      url: '',
      caption: '核心卖点图',
    });
  });
});
