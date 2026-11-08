import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssetThumb } from './AssetThumb';

describe('AssetThumb', () => {
  it('图片素材使用 img 渲染', () => {
    render(
      <AssetThumb
        src="/uploads/original/image.png"
        alt="图片缩略图"
        className="size-full"
        format="image/png"
      />,
    );

    const image = screen.getByRole('img', { name: '图片缩略图' });
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('data-asset-thumb', 'image');
  });

  it('视频素材使用 video 渲染，而不是把 MP4 交给 img 解码', () => {
    render(
      <AssetThumb
        src="/uploads/generated/video.mp4?w=320&h=320"
        alt="视频缩略图"
        className="size-full"
        format="video/mp4"
      />,
    );

    const video = screen.getByLabelText('视频缩略图');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('data-asset-thumb', 'video');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).toHaveProperty('muted', true);
  });

  it('视频加载失败时显示稳定占位', () => {
    render(
      <AssetThumb
        src="/uploads/generated/missing.mp4"
        alt="视频缩略图"
        className="size-full"
        format="video/mp4"
      />,
    );

    fireEvent.error(screen.getByLabelText('视频缩略图'));
    expect(screen.getByRole('img', { name: '视频缩略图，缩略图加载失败' })).toBeVisible();
  });
});
