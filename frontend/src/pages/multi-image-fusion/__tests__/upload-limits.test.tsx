import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiFusionAssets } from '../useMultiFusionAssets';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  upload: vi.fn(),
  message: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  openLogin: vi.fn(),
  validateImageFile: vi.fn(),
}));

vi.mock('../../../ui', () => ({
  useApp: () => ({ message: mocks.message }),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token-1', openLogin: mocks.openLogin }),
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
  assetsApi: { upload: mocks.upload },
  assetSrc: vi.fn(() => null),
  toAbsoluteUrl: vi.fn(() => null),
}));

function imageFile(name: string, size: number): File {
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('多图融合上传运行时限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateImageFile.mockImplementation(async (file: File) =>
      file.size > 8 * 1024 * 1024 ? '单张图片不能超过 8MB' : null,
    );
  });

  it('超限批次在建项目和上传请求前被拦截', async () => {
    const { result } = renderHook(() => useMultiFusionAssets());

    await act(async () => {
      await result.current.uploadTo([imageFile('small.png', 1024), imageFile('big.png', 9 * 1024 * 1024)], 'accent');
    });

    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('单张图片不能超过 8MB');
    expect(result.current.uploading).toBe(false);
    expect(result.current.accents).toEqual([]);
  });

  it('像素超限在创建项目和上传请求前被拦截', async () => {
    mocks.validateImageFile.mockResolvedValueOnce('图片像素总数不能超过 1,000,000');
    const { result } = renderHook(() => useMultiFusionAssets());

    await act(async () => {
      await result.current.uploadTo([imageFile('huge.png', 1024)], 'accent');
    });

    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('图片像素总数不能超过 1,000,000');
    expect(result.current.accents).toEqual([]);
  });

  it('混选非图片时只上传合法项，不整批拒绝', async () => {
    mocks.upload.mockResolvedValueOnce({ id: 'asset-1', signedUrl: '/uploads/valid.png' });
    const { result } = renderHook(() => useMultiFusionAssets());

    await act(async () => {
      await result.current.uploadTo(
        [new File(['x'], 'notes.txt', { type: 'text/plain' }), imageFile('valid.png', 1024)],
        'accent',
      );
    });

    expect(mocks.message.warning).toHaveBeenCalledWith('已忽略 1 个非图片文件');
    expect(mocks.message.error).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ name: 'valid.png' });
    expect(result.current.accents).toHaveLength(1);
  });
});
