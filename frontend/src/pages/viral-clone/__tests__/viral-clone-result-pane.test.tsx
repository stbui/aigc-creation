import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ViralCloneResultPane } from '../ViralCloneResultPane';
import type { PkAsset, PkResult } from '../constants';

const images: PkAsset[] = [
  { id: 'product-1', url: '/product.png', name: 'product.png' },
];
const reference: PkAsset = { id: 'reference-1', url: '/reference.png', name: 'reference.png' };

function paneProps(
  overrides: Partial<ComponentProps<typeof ViralCloneResultPane>> = {},
): ComponentProps<typeof ViralCloneResultPane> {
  return {
    gallery: {
      items: [],
      loading: false,
      error: null,
      reload: vi.fn(async () => 0),
    },
    generating: false,
    submitting: false,
    images,
    reference,
    result: null,
    onRefresh: vi.fn(),
    onDelete: vi.fn(),
    onUseAsReference: vi.fn(),
    ...overrides,
  };
}

describe('ViralCloneResultPane 本次复刻展示时机', () => {
  it('未点击生成时只显示空态，不渲染已上传的商品图和参考图', () => {
    render(<ViralCloneResultPane {...paneProps()} />);

    expect(screen.getByText('上传商品图和参考图开始复刻')).toBeInTheDocument();
    expect(screen.queryByAltText('商品上传图 1')).not.toBeInTheDocument();
    expect(screen.queryByAltText('参考图')).not.toBeInTheDocument();
    expect(screen.queryByText('本次复刻')).not.toBeInTheDocument();
  });

  it('点击生成后才渲染本次复刻图片和生成中状态', () => {
    const { rerender } = render(<ViralCloneResultPane {...paneProps()} />);

    rerender(<ViralCloneResultPane {...paneProps({ submitting: true, generating: true })} />);

    expect(screen.getByText('本次复刻')).toBeInTheDocument();
    expect(screen.getByAltText('商品上传图 1')).toBeInTheDocument();
    expect(screen.getByAltText('参考图')).toBeInTheDocument();
    expect(screen.getByText('正在复刻，请稍候…')).toBeInTheDocument();
  });

  it('提交失败后保留本次输入并展示失败结果', () => {
    const result: PkResult = { status: 'failed', errorCode: 'EMPTY_OUTPUT' };
    render(<ViralCloneResultPane {...paneProps({ result })} />);

    expect(screen.getByText('本次复刻')).toBeInTheDocument();
    expect(screen.getByAltText('商品上传图 1')).toBeInTheDocument();
    expect(screen.getByText('生成失败')).toBeInTheDocument();
  });
});
