import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ViralCloneResultList } from '../ViralCloneResultList';
import type { GalleryItem, UploadedImage } from '../hooks';
import type { PolledResult } from '../utils';

const images: UploadedImage[] = [
  { id: 'product-1', url: '/product.png', name: 'product.png' },
];
const reference: UploadedImage = { id: 'reference-1', url: '/reference.png', name: 'reference.png' };

function listProps(
  overrides: Partial<ComponentProps<typeof ViralCloneResultList>> = {},
): ComponentProps<typeof ViralCloneResultList> {
  return {
    items: [],
    loading: false,
    error: null,
    submitting: false,
    images,
    reference,
    result: null,
    onDelete: vi.fn(),
    onUseAsReference: vi.fn(),
    ...overrides,
  };
}

describe('ViralCloneResultList 本次复刻展示时机', () => {
  it('未点击生成时只显示空态，不渲染已上传的商品图和参考图', () => {
    render(<ViralCloneResultList {...listProps()} />);

    expect(screen.getByText('上传商品图和参考图开始复刻')).toBeInTheDocument();
    expect(screen.queryByAltText('商品上传图 1')).not.toBeInTheDocument();
    expect(screen.queryByAltText('参考图')).not.toBeInTheDocument();
    expect(screen.queryByText('本次复刻')).not.toBeInTheDocument();
  });

  it('点击生成后才渲染本次复刻图片和生成中状态', () => {
    const { rerender } = render(<ViralCloneResultList {...listProps()} />);

    rerender(<ViralCloneResultList {...listProps({ submitting: true })} />);

    expect(screen.getByText('本次复刻')).toBeInTheDocument();
    expect(screen.getByAltText('商品上传图 1')).toBeInTheDocument();
    expect(screen.getByAltText('参考图')).toBeInTheDocument();
    expect(screen.getByText('正在复刻，请稍候…')).toBeInTheDocument();
  });

  it('提交失败后保留本次输入并展示失败结果', () => {
    const result: PolledResult = { status: 'failed', errorCode: 'EMPTY_OUTPUT' };
    render(<ViralCloneResultList {...listProps({ result })} />);

    expect(screen.getByText('本次复刻')).toBeInTheDocument();
    expect(screen.getByAltText('商品上传图 1')).toBeInTheDocument();
    // 失败态在行头状态标签与生成图占位格各出现一次（与批次卡同口径）
    expect(screen.getAllByText('生成失败').length).toBeGreaterThan(0);
    expect(document.querySelector('.vc-result-status.is-failed')).not.toBeNull();
  });

  it('历史行展示商品名 / 状态 / 行级操作，重新生成回调透传该任务', () => {
    const onRegenerateRow = vi.fn();
    const item: GalleryItem = {
      id: 'task-1',
      url: '/uploads/generated/task-1/output-1.png',
      caption: '高度复刻',
      params: { productName: '蓝色手提包', degree: 'high_replica' },
      createdAt: '2026-11-14T00:00:00.000Z',
    };
    render(<ViralCloneResultList {...listProps({ items: [item], onRegenerateRow })} />);

    expect(screen.getByText('商品：蓝色手提包')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键下载这次复刻的全部图片' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新生成这次复刻' }));
    expect(onRegenerateRow).toHaveBeenCalledWith(item);
  });

  it('失败任务已进历史时撤下本次占位行与顶部失败提示，不重复显示', () => {
    const item: GalleryItem = { id: 'task-x', url: '', status: 'failed' };
    render(
      <ViralCloneResultList
        {...listProps({
          items: [item],
          result: { status: 'failed', errorCode: 'EMPTY_OUTPUT' },
          currentTaskId: 'task-x',
        })}
      />,
    );

    expect(screen.queryByText('本次复刻')).not.toBeInTheDocument();
    expect(screen.queryByText(/本次生成失败/)).not.toBeInTheDocument();
    expect(screen.getAllByText('生成失败').length).toBeGreaterThan(0);
  });

  it('失败的历史任务也能被删除（没有产出图）', () => {
    const item: GalleryItem = { id: 'task-failed', url: '', status: 'failed' };
    render(<ViralCloneResultList {...listProps({ items: [item] })} />);

    expect(screen.getByRole('button', { name: '删除这次复刻结果' })).toBeInTheDocument();
  });
});
