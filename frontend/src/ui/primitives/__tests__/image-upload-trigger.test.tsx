import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageUploadTrigger } from '../image-upload-trigger';

describe('ImageUploadTrigger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('点击文字入口开框，选中文件后回传并清空 value', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const onFiles = vi.fn();
    const { container } = render(
      <ImageUploadTrigger accept="image/png" onFiles={onFiles}>
        上传参考图
      </ImageUploadTrigger>,
    );

    fireEvent.click(screen.getByRole('button', { name: '上传参考图' }));
    expect(click).toHaveBeenCalledTimes(1);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['image'], 'ref.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
    expect(input.value).toBe('');
  });

  it('禁用时不打开文件选择', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <ImageUploadTrigger disabled onFiles={() => undefined}>
        上传参考图
      </ImageUploadTrigger>,
    );

    fireEvent.click(screen.getByRole('button', { name: '上传参考图' }));
    expect(click).not.toHaveBeenCalled();
  });
});
