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

    fireEvent.click(screen.getByRole('button', { name: '提示词' }));
    expect(screen.getByText('生成提示词')).toBeVisible();
    expect(screen.getByText(PROMPT)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPT));
    expect(screen.getByRole('button', { name: '已复制' })).toBeVisible();
  });

  it('没有提示词时不渲染入口', () => {
    renderLightbox();
    expect(screen.queryByRole('button', { name: '提示词' })).not.toBeInTheDocument();
  });
});
