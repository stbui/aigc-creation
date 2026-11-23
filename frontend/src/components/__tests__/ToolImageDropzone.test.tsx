import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToolImageDropzone } from '../ToolImageDropzone';

const IMAGE = { id: 'asset-1', url: '/uploads/probe.png', name: 'probe.png' };

function renderDropzone(overrides: Partial<Parameters<typeof ToolImageDropzone>[0]> = {}) {
  return render(
    <ToolImageDropzone
      title="上传商品图"
      images={[]}
      max={3}
      uploading={false}
      onFiles={() => undefined}
      onRemove={() => undefined}
      onOpenLibrary={() => undefined}
      onOpenMobile={() => undefined}
      {...overrides}
    />,
  );
}

function renderFilledSingle(onFiles = vi.fn()) {
  const result = render(
    <ToolImageDropzone
      title="上传参考图"
      images={[IMAGE]}
      max={1}
      uploading={false}
      onFiles={onFiles}
      onRemove={vi.fn()}
      onOpenLibrary={vi.fn()}
      onOpenMobile={vi.fn()}
      noun="参考图片"
      single
    />,
  );
  const dropzone = result.container.querySelector<HTMLElement>('[data-slot="image-upload-area"]');
  const input = dropzone?.querySelector<HTMLInputElement>('input[type="file"]');
  if (!dropzone || !input) throw new Error('单图上传区未渲染完整');
  return { ...result, dropzone, input, onFiles };
}

describe('ToolImageDropzone', () => {
  it('渲染标题、必填标记、计数器与上传入口', () => {
    const onOpenLibrary = vi.fn();
    const onOpenMobile = vi.fn();
    const { container } = renderDropzone({
      images: [IMAGE],
      onOpenLibrary,
      onOpenMobile,
    });

    expect(screen.getByText(/上传商品图/)).toBeTruthy();
    expect(container.querySelector('[data-slot="image-upload-required"]')).not.toBeNull();
    expect(screen.getByText('1/3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '从素材库导入' }));
    fireEvent.click(screen.getByRole('button', { name: '手机上传' }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(onOpenMobile).toHaveBeenCalledTimes(1);
  });

  it('移除与补位透传到共享上传区', () => {
    const onRemove = vi.fn();
    renderDropzone({ images: [IMAGE], onRemove });

    fireEvent.click(screen.getByRole('button', { name: '移除 probe.png' }));
    expect(onRemove).toHaveBeenCalledWith('asset-1');
    expect(screen.getByRole('button', { name: '添加商品图片' })).toBeTruthy();
  });

  it('单图位不渲染计数器与补位块', () => {
    renderDropzone({
      title: '上传参考图',
      noun: '参考图片',
      required: false,
      images: [IMAGE],
      max: 1,
      single: true,
      showCount: false,
    });

    expect(screen.queryByText('1/1')).toBeNull();
    expect(screen.queryByRole('button', { name: '添加参考图片' })).toBeNull();
  });

  it('选填标题不带必填标记', () => {
    const { container } = renderDropzone({ required: false, title: '上传参考图' });
    expect(container.querySelector('[data-slot="image-upload-required"]')).toBeNull();
  });

  it('空态渲染上传提示与默认额度文案', () => {
    renderDropzone({ max: 3 });

    expect(screen.getByText('点击、拖拽或粘贴商品图片到此处上传')).toBeTruthy();
    expect(screen.getByText('最多可上传 3 张商品图片，单张不超过 10MB')).toBeTruthy();
  });

  it('空态副文案可由 emptyHint 覆盖', () => {
    renderDropzone({ emptyHint: '最多 1 张参考图' });

    expect(screen.getByText('最多 1 张参考图')).toBeTruthy();
    expect(screen.queryByText(/单张不超过/)).toBeNull();
  });

  it('点击空态提示打开文件选择', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    renderDropzone();

    fireEvent.click(screen.getByRole('button', { name: /点击、拖拽或粘贴商品图片到此处上传/ }));

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('点击满位单图上传区会重新打开文件选择框', () => {
    const { dropzone, input } = renderFilledSingle();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(dropzone);

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('替换按钮可聚焦、可用键盘触发且不会让上传区重复打开文件框', async () => {
    const user = userEvent.setup();
    const { input } = renderFilledSingle();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const replace = screen.getByRole('button', { name: '替换参考图片' });

    replace.focus();
    expect(document.activeElement).toBe(replace);
    await user.keyboard('{Enter}');

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('替换按钮可点击，满位后拖拽仍会回传文件', () => {
    const onFiles = vi.fn();
    const { dropzone, input } = renderFilledSingle(onFiles);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: '替换参考图片' }));
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['image'], 'next.png', { type: 'image/png' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
    click.mockRestore();
  });
});
