import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViralCloneAssets } from '../hooks';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  upload: vi.fn(),
  message: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  validateImageFile: vi.fn(),
  setSearchParams: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
}));

vi.mock('../../../ui', () => ({
  useApp: () => ({ message: mocks.message }),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));

vi.mock('../../../hooks/useProject', () => ({
  useProject: () => ({ ensureProject: mocks.ensureProject }),
}));

vi.mock('../../../hooks/usePasteUpload', () => ({
  usePasteUpload: vi.fn(),
}));

vi.mock('../../../hooks/useTargetedAssetPicker', () => ({
  useTargetedAssetPicker: () => ({
    libraryTarget: null,
    library: {},
    openLibraryFor: vi.fn(),
    mobile: { openMobile: vi.fn() },
  }),
}));

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    allowedLabel: 'PNG / JPG / WebP',
    isSupportedImageFile: (file: File) => file.type.startsWith('image/'),
    validateImageFile: mocks.validateImageFile,
  }),
}));

vi.mock('../api', () => ({
  assetsApi: {
    upload: mocks.upload,
    get: vi.fn(),
  },
  assetSrc: vi.fn(() => null),
  toAbsoluteUrl: vi.fn(() => null),
}));

function imageFile(name: string, size: number): File {
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('爆款复刻上传运行时限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateImageFile.mockImplementation(async (file: File) =>
      file.size > 8 * 1024 * 1024 ? '单张图片不能超过 8MB' : null,
    );
  });

  it('商品图批次超限时在建项目和上传请求前被拦截', async () => {
    const { result } = renderHook(() => useViralCloneAssets({ imageMax: 2, modelImageMax: 3 }));

    await act(async () => {
      await result.current.uploadFiles([
        imageFile('small.png', 1024),
        imageFile('big.png', 9 * 1024 * 1024),
      ]);
    });

    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('单张图片不能超过 8MB');
    expect(result.current.uploading).toBe(false);
    expect(result.current.images).toEqual([]);
  });

  it('参考图像素超限时在建项目和上传请求前被拦截', async () => {
    mocks.validateImageFile.mockResolvedValueOnce('图片像素总数不能超过 1,000,000');
    const { result } = renderHook(() => useViralCloneAssets({ imageMax: 2, modelImageMax: 3 }));

    await act(async () => {
      await result.current.uploadReference([imageFile('huge.png', 1024)]);
    });

    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('图片像素总数不能超过 1,000,000');
    expect(result.current.reference).toBeNull();
  });

  it('商品图混选非图片时只上传合法项，不整批拒绝', async () => {
    mocks.upload.mockResolvedValueOnce({ id: 'asset-1', signedUrl: '/uploads/valid.png' });
    const { result } = renderHook(() => useViralCloneAssets({ imageMax: 2, modelImageMax: 3 }));

    await act(async () => {
      await result.current.uploadFiles([
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
        imageFile('valid.png', 1024),
      ]);
    });

    expect(mocks.message.warning).toHaveBeenCalledWith('已忽略 1 个非图片文件');
    expect(mocks.message.error).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ name: 'valid.png' });
    expect(result.current.images).toHaveLength(1);
  });
});
