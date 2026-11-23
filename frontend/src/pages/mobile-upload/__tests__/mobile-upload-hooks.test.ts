import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_IMAGE_MB } from '../../../lib/constants';
import { MAX_TOTAL_BYTES } from '../constants';
import { useMobileUpload } from '../hooks';

vi.mock('../api', () => ({
  mobileUploadApi: { receive: vi.fn() },
}));

const createObjectURL = vi.fn<(blob: Blob | MediaSource) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

let objectUrlSequence = 0;

beforeEach(() => {
  objectUrlSequence = 0;
  createObjectURL.mockReset().mockImplementation(() => {
    objectUrlSequence += 1;
    return `blob:mobile-upload-${objectUrlSequence}`;
  });
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
});

function imageFile(name: string, size = 1024): File {
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

function renderMobileUpload() {
  return renderHook(() => useMobileUpload('session-1', 'token-1'));
}

describe('useMobileUpload objectURL 生命周期', () => {
  it('首张成功后第二张超限时撤销已创建 URL，且不污染 picked', async () => {
    const { result } = renderMobileUpload();

    await act(async () => {
      await result.current.addFiles([
        imageFile('first.png'),
        imageFile('too-large.png', MAX_IMAGE_MB * 1024 * 1024 + 1),
      ]);
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mobile-upload-1');
    expect(result.current.picked).toEqual([]);
    expect(result.current.error).toBe(`单张不超过 ${MAX_IMAGE_MB}MB`);
  });

  it('整批总大小超限时仍撤销本批全部 URL，且不污染 picked', async () => {
    const { result } = renderMobileUpload();
    const files = Array.from({ length: 7 }, (_, index) =>
      imageFile(`batch-${index}.png`, MAX_IMAGE_MB * 1024 * 1024),
    );

    await act(async () => {
      await result.current.addFiles(files);
    });

    expect(files.length * MAX_IMAGE_MB * 1024 * 1024).toBeGreaterThan(MAX_TOTAL_BYTES);
    expect(createObjectURL).toHaveBeenCalledTimes(files.length);
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(
      files.map((_, index) => `blob:mobile-upload-${index + 1}`),
    );
    expect(result.current.picked).toEqual([]);
  });

  it('移除单张仍撤销对应 URL', async () => {
    const { result } = renderMobileUpload();

    await act(async () => {
      await result.current.addFiles([imageFile('remove.png')]);
    });
    expect(result.current.picked).toHaveLength(1);

    act(() => {
      result.current.removeAt(0);
    });

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mobile-upload-1');
    expect(result.current.picked).toEqual([]);
  });

  it('卸载时仍撤销当前列表的 URL', async () => {
    const { result, unmount } = renderMobileUpload();

    await act(async () => {
      await result.current.addFiles([imageFile('unmount.png')]);
    });
    unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mobile-upload-1');
  });
});
