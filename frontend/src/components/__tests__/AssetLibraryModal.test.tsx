import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UiProvider } from '../../ui';
import { AssetLibraryModal } from '../AssetLibraryModal';
import type { Asset } from '../../types/api';

vi.mock('../../hooks/useCapabilities', () => ({
  useCapabilities: () => ({
    data: {
      groups: [],
      workbenchIds: [],
      items: [
        { id: 'main_image', name: '商品主图' },
        { id: 'detail_image', name: '商品详情图' },
      ],
    },
    loading: false,
    error: null,
  }),
}));

/**
 * 素材库「全部图片」会把原始素材与生成素材混排。卡片必须直接标出来源，
 * 用户才能一眼找到自己上传的图片，而不是逐个点开确认。
 */
function asset(over: Partial<Asset> & Pick<Asset, 'id' | 'kind' | 'sourceUrl'>): Asset {
  return {
    projectId: 'project-1',
    ownerId: 'user-1',
    format: 'image/png',
    sizeBytes: 10,
    createdAt: '2026-11-03T00:00:00.000Z',
    width: 1024,
    height: 1024,
    ...over,
  } as Asset;
}

describe('AssetLibraryModal', () => {
  it('在缩略图上标出用户上传与 AI 生成素材', () => {
    render(
      <UiProvider>
        <AssetLibraryModal
          open
          loading={false}
          items={[
            asset({ id: 'asset-original', kind: 'original', sourceUrl: '/uploads/original.png' }),
            asset({ id: 'asset-generated', kind: 'generated', sourceUrl: '/uploads/generated.png' }),
          ]}
          onCancel={vi.fn()}
          onPick={vi.fn()}
        />
      </UiProvider>,
    );

    expect(screen.getByText('用户上传')).toHaveClass('alp-origin-badge', 'is-original');
    expect(screen.getByText('AI 生成')).toHaveClass('alp-origin-badge', 'is-generated');
    expect(screen.queryByText('我的素材库')).not.toBeInTheDocument();
    expect(screen.queryByText('1024×1024')).not.toBeInTheDocument();

    const dateGroup = screen.getByRole('radiogroup', { name: '日期筛选' });
    expect(within(dateGroup).getByRole('radio', { name: '全部' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(dateGroup).getByRole('radio', { name: '今天' }));
    expect(within(dateGroup).getByRole('radio', { name: '今天' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('按素材真实用途聚合分类并筛选', () => {
    render(
      <UiProvider>
        <AssetLibraryModal
          open
          loading={false}
          items={[
            asset({ id: 'asset-main', kind: 'generated', sourceUrl: '/uploads/main.png', capability: 'main_image' }),
            asset({ id: 'asset-detail', kind: 'generated', sourceUrl: '/uploads/detail.png', capability: 'detail_image' }),
            asset({ id: 'asset-original', kind: 'original', sourceUrl: '/uploads/original.png' }),
          ]}
          onCancel={vi.fn()}
          onPick={vi.fn()}
        />
      </UiProvider>,
    );

    const categoryNav = screen.getByRole('navigation', { name: '用途分类' });
    expect(within(categoryNav).getByRole('button', { name: /商品主图/ })).toHaveTextContent('1');
    expect(within(categoryNav).getByRole('button', { name: /商品详情图/ })).toHaveTextContent('1');
    expect(within(categoryNav).getByRole('button', { name: /未关联用途/ })).toHaveTextContent('1');

    fireEvent.click(within(categoryNav).getByRole('button', { name: /商品主图/ }));

    expect(screen.getByAltText('/uploads/main.png')).toBeInTheDocument();
    expect(screen.queryByAltText('/uploads/detail.png')).not.toBeInTheDocument();
    expect(screen.queryByAltText('/uploads/original.png')).not.toBeInTheDocument();
  });

  it('素材超过一页时支持翻页且保留当前选择器状态', () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      asset({
        id: `asset-${index + 1}`,
        kind: 'original',
        sourceUrl: `/uploads/asset-${index + 1}.png`,
      }),
    );

    render(
      <UiProvider>
        <AssetLibraryModal
          open
          loading={false}
          items={items}
          onCancel={vi.fn()}
          onPick={vi.fn()}
        />
      </UiProvider>,
    );

    const pagination = screen.getByRole('navigation', { name: '素材库分页' });
    expect(within(pagination).getByText('第 1 / 2 页 · 共 25 个')).toBeInTheDocument();
    const firstImage = screen.getByAltText('/uploads/asset-1.png');
    expect(firstImage).toBeInTheDocument();
    expect(screen.queryByAltText('/uploads/asset-25.png')).not.toBeInTheDocument();
    fireEvent.click(firstImage);
    expect(firstImage.closest('button')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(pagination).getByRole('button', { name: '下一页' }));

    expect(within(pagination).getByText('第 2 / 2 页 · 共 25 个')).toBeInTheDocument();
    expect(screen.queryByAltText('/uploads/asset-1.png')).not.toBeInTheDocument();
    expect(screen.getByAltText('/uploads/asset-25.png')).toBeInTheDocument();

    fireEvent.click(within(pagination).getByRole('button', { name: '上一页' }));
    expect(screen.getByAltText('/uploads/asset-1.png').closest('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
