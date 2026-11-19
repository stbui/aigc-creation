import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Upload } from '../upload';

describe('Upload', () => {
  it('选中文件后回传新的文件列表', async () => {
    const onFilesChange = vi.fn();
    const { container } = render(<Upload onFilesChange={onFilesChange}>上传</Upload>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(['image'], 'sample.png', { type: 'image/png' });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(onFilesChange).toHaveBeenCalledTimes(1));
    expect(onFilesChange.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        name: 'sample.png',
        status: 'uploading',
        originFileObj: file,
      }),
    ]);
  });

  it('onSelect 拒绝时不回传文件列表', async () => {
    const onFilesChange = vi.fn();
    const { container } = render(
      <Upload onSelect={() => false} onFilesChange={onFilesChange}>
        上传
      </Upload>,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['text'], 'sample.txt', { type: 'text/plain' });

    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(input!.value).toBe(''));
    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it('达到 maxCount 后不再渲染触发按钮', () => {
    const { queryByRole } = render(
      <Upload
        maxCount={1}
        files={[{ uid: 'a', name: 'a.png', status: 'done' }]}
        onFilesChange={() => undefined}
      >
        上传
      </Upload>,
    );
    expect(queryByRole('button', { name: '上传' })).toBeNull();
  });
});
