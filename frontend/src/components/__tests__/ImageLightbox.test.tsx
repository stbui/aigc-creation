import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageLightbox } from '../ImageLightbox';

const PROMPT = '清晨窗边的木质桌面，柔和自然光，极简 ins 风';

function renderLightbox(prompt?: string) {
  return render(
    <ImageLightbox
      items={[{ id: 'asset-1', url: '/uploads/generated/result.png', width: 1024, height: 1024, prompt }]}
      index={0}
      onIndexChange={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('ImageLightbox 提示词', () => {
  it('展开完整提示词并支持复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderLightbox(PROMPT);

    fireEvent.click(screen.getByRole('button', { name: '查看提示词' }));
    expect(screen.getByText('生成提示词')).toBeVisible();
    expect(screen.getByText(PROMPT)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPT));
    expect(screen.getByRole('button', { name: '已复制' })).toBeVisible();
  });

  it('没有提示词时不渲染入口', () => {
    renderLightbox();
    expect(screen.queryByRole('button', { name: '查看提示词' })).not.toBeInTheDocument();
  });
});

describe('ImageLightbox 浏览与缩放', () => {
  function renderGallery() {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ImageLightbox
        items={[
          { id: 'asset-1', url: '/uploads/generated/one.png', width: 1024, height: 1024 },
          { id: 'asset-2', url: '/uploads/generated/two.png', width: 1024, height: 1024 },
        ]}
        index={0}
        onIndexChange={onIndexChange}
        onClose={onClose}
      />,
    );
    return { onIndexChange, onClose };
  }

  it('支持键盘翻页、关闭与复位缩放', () => {
    const { onIndexChange, onClose } = renderGallery();
    const img = screen.getByRole('img', { name: '生成图预览' });

    fireEvent.load(img);
    fireEvent.click(img);
    expect(screen.getByRole('button', { name: '当前缩放 200%，点击适应窗口' })).toBeVisible();

    fireEvent.keyDown(window, { key: '0' });
    expect(screen.getByRole('button', { name: '适应窗口' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenCalledWith(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('支持旋转，并且不再展示日期与图片尺寸', () => {
    const createdAt = '2026-11-03T09:00:00.000Z';
    render(
      <ImageLightbox
        items={[
          {
            id: 'asset-1',
            url: '/uploads/generated/one.png',
            width: 1024,
            height: 768,
            createdAt,
            meta: ['自定义信息'],
          },
        ]}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('自定义信息')).toBeVisible();
    expect(screen.queryByText('1024×768')).not.toBeInTheDocument();
    expect(screen.queryByText(new Date(createdAt).toLocaleString('zh-CN'))).not.toBeInTheDocument();

    const img = screen.getByRole('img', { name: '生成图预览' });
    fireEvent.load(img);
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转图片' }));
    expect(img.style.transform).toContain('rotate(90deg)');

    fireEvent.keyDown(window, { key: 'r' });
    expect(img.style.transform).toContain('rotate(180deg)');
  });
});
