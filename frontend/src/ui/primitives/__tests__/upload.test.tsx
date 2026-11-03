import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Upload } from '../upload';

describe('Upload 兼容层', () => {
  it('接受文件后调用 onChange 并回传 UploadFile 列表', async () => {
    const onChange = vi.fn();
    const { container } = render(<Upload onChange={onChange}>上传</Upload>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(['image'], 'sample.png', { type: 'image/png' });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].fileList).toEqual([
      expect.objectContaining({
        name: 'sample.png',
        status: 'uploading',
        originFileObj: file,
      }),
    ]);
  });

  it('beforeUpload 拒绝时不触发 onChange', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Upload beforeUpload={() => Upload.LIST_IGNORE} onChange={onChange}>
        上传
      </Upload>,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['text'], 'sample.txt', { type: 'text/plain' });

    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(input!.value).toBe(''));
    expect(onChange).not.toHaveBeenCalled();
  });
});
