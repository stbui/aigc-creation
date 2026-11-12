import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ViralCloneResultList } from '../ViralCloneResultList';
import type { UploadedImage } from '../hooks';
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
    expect(screen.getByText('生成失败')).toBeInTheDocument();
  });
});
