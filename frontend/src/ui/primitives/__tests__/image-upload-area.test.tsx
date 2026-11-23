import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageUploadArea, type ImageUploadItem } from '../image-upload-area';

const IMAGE: ImageUploadItem = {
  id: 'asset-1',
  url: '/uploads/probe.png',
  name: 'probe.png',
};

function fileInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[type="file"]')!;
}

describe('ImageUploadArea', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('空态补位块打开文件选择，并回传所选文件', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const onFiles = vi.fn();
    const { container } = render(
      <ImageUploadArea
        images={[]}
        max={3}
        ariaLabel="上传商品图"
        onFiles={onFiles}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加图片' }));
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['image'], 'sample.png', { type: 'image/png' });
    const input = fileInput(container);
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
    expect(input.value).toBe('');
  });

  it('拖拽高亮后落下文件，回传文件并清除高亮', () => {
    const onFiles = vi.fn();
    const { container } = render(
      <ImageUploadArea
        images={[]}
        max={3}
        ariaLabel="上传商品图"
        onFiles={onFiles}
        onRemove={() => undefined}
      />,
    );
    const zone = container.firstElementChild!;
    const file = new File(['image'], 'drop.png', { type: 'image/png' });

    fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
    expect(zone.getAttribute('data-dragging')).toBe('true');

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
    expect(zone.getAttribute('data-dragging')).toBeNull();
  });

  it('移除按钮回传 id，且不触发上传区开框', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const onRemove = vi.fn();
    render(
      <ImageUploadArea
        images={[IMAGE]}
        max={3}
        ariaLabel="上传商品图"
        onFiles={() => undefined}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '移除 probe.png' }));

    expect(onRemove).toHaveBeenCalledWith('asset-1');
    expect(click).not.toHaveBeenCalled();
  });

  it('达到上限后不再渲染补位块', () => {
    render(
      <ImageUploadArea
        images={[IMAGE, { ...IMAGE, id: 'asset-2', name: 'second.png' }]}
        max={2}
        ariaLabel="上传商品图"
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: '添加图片' })).toBeNull();
  });

  it('单图位空态渲染补位块，input 不带 multiple', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const { container } = render(
      <ImageUploadArea
        images={[]}
        max={1}
        single
        ariaLabel="上传参考图"
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加图片' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(fileInput(container)).not.toHaveAttribute('multiple');
  });

  it('上传中渲染遮罩', () => {
    const { container } = render(
      <ImageUploadArea
        images={[]}
        max={3}
        uploading
        ariaLabel="上传商品图"
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(container.querySelector('[data-slot="image-upload-loading"]')).not.toBeNull();
  });

  it('优先使用 thumbUrl 渲染缩略图', () => {
    render(
      <ImageUploadArea
        images={[{ ...IMAGE, thumbUrl: '/thumb.png' }]}
        max={3}
        ariaLabel="上传商品图"
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(screen.getByAltText('probe.png')).toHaveAttribute('src', '/thumb.png');
  });

  it('空态与已选区交给调用方渲染，并透传操作入口', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <ImageUploadArea
        images={[]}
        max={3}
        ariaLabel="上传商品图"
        emptyContent={(controls) => (
          <button type="button" onClick={controls.open}>
            自定义空态
          </button>
        )}
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '自定义空态' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('已选区自定义渲染时不再渲染默认缩略图网格', () => {
    const onRemove = vi.fn();
    render(
      <ImageUploadArea
        images={[IMAGE]}
        max={3}
        ariaLabel="上传商品图"
        renderPreview={(images, controls) => (
          <button type="button" onClick={() => controls.remove(images[0].id)}>
            {images.length} 张
          </button>
        )}
        onFiles={() => undefined}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1 张' }));
    expect(onRemove).toHaveBeenCalledWith('asset-1');
    expect(screen.queryByAltText('probe.png')).toBeNull();
  });

  it('空态点击命中区空白处也打开文件选择', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const { container } = render(
      <ImageUploadArea
        images={[]}
        max={3}
        ariaLabel="上传商品图"
        emptyContent={(controls) => (
          <button type="button" onClick={controls.open}>
            自定义空态
          </button>
        )}
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(container.firstElementChild!);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('已选满时只有 replaceOnClick 才允许点命中区重新开框', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const { rerender, container } = render(
      <ImageUploadArea
        images={[IMAGE]}
        max={1}
        ariaLabel="替换图片"
        renderPreview={() => <span>已选图</span>}
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(container.firstElementChild!);
    expect(click).not.toHaveBeenCalled();

    rerender(
      <ImageUploadArea
        images={[IMAGE]}
        max={1}
        replaceOnClick
        ariaLabel="替换图片"
        renderPreview={() => <span>已选图</span>}
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(container.firstElementChild!);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
