import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSkuDraft } from '../useSkuDraft';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  upload: vi.fn(),
  message: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  reportError: vi.fn(),
  validateImageFile: vi.fn(),
}));

vi.mock('../../../ui', () => ({
  useApp: () => ({ message: mocks.message }),
}));

vi.mock('../../../hooks/useProject', () => ({
  useProject: () => ({ ensureProject: mocks.ensureProject }),
}));

vi.mock('../../../hooks/useGenerateError', () => ({
  useGenerateError: () => mocks.reportError,
}));

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    validateImageFile: mocks.validateImageFile,
  }),
}));

vi.mock('../api', () => ({
  assetsApi: { upload: mocks.upload },
  toToolAsset: vi.fn(),
}));

function imageFile(name: string, size: number): File {
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('SKU 上传运行时限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateImageFile.mockImplementation(async (file: File) =>
      file.size > 8 * 1024 * 1024 ? '单张图片不能超过 8MB' : null,
    );
  });

  it('模板图超限时在建项目和上传请求前被拦截', async () => {
    const { result } = renderHook(() => useSkuDraft({ onResetBatch: vi.fn() }));

    await act(async () => {
      await result.current.uploadTemplate([imageFile('big.png', 9 * 1024 * 1024)]);
    });

    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('单张图片不能超过 8MB');
    expect(result.current.uploading).toBe(false);
    expect(result.current.template).toBeNull();
  });
});
