import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { UploadLimitsProvider } from '../../context/UploadLimitsContext';
import { useImageUpload } from '../useImageUpload';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  upload: vi.fn(),
  message: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  read: vi.fn(),
  createImageBitmap: vi.fn(),
}));

vi.mock('../../lib/api-settings', () => ({
  publicSettingsApi: { read: mocks.read },
  UPLOAD_LIMITS_CHANGED_EVENT: 'upload-limits:changed',
}));

vi.mock('../../lib/api', () => ({
  assetsApi: { upload: mocks.upload },
  assetSrc: (asset?: { signedUrl?: string | null; sourceUrl?: string | null }) =>
    asset?.signedUrl ?? asset?.sourceUrl ?? '',
  toAbsoluteUrl: (url?: string | null) => url ?? '',
}));

vi.mock('../useProject', () => ({
  useProject: () => ({ ensureProject: mocks.ensureProject }),
}));
vi.mock('../useAssetLibrary', () => ({
  useAssetLibrary: () => ({
    open: false,
    loading: false,
    items: [],
    error: null,
    openLibrary: vi.fn(),
    closeLibrary: vi.fn(),
    pick: vi.fn(),
  }),
}));
vi.mock('../usePasteUpload', () => ({ usePasteUpload: vi.fn() }));
vi.mock('../../ui', () => ({ useApp: () => ({ message: mocks.message }) }));

function wrapper({ children }: { children: ReactNode }) {
  return <UploadLimitsProvider>{children}</UploadLimitsProvider>;
}

function imageFile(name: string, size = 1024): File {
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('useImageUpload 真实 Provider 运行时拦截', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProject.mockResolvedValue('project-1');
    mocks.upload.mockResolvedValue({ id: 'asset-1', signedUrl: '/uploads/valid.png' });
    mocks.read.mockResolvedValue({
      upload: {
        maxSizeMb: 1,
        maxBytes: 1024 * 1024,
        maxPixels: 100,
        allowedTypes: 'jpg,png,webp',
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        allowedLabels: ['JPG', 'PNG', 'WebP'],
      },
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      writable: true,
      value: mocks.createImageBitmap,
    });
  });

  it('超过运行时 maxPixels 时在上传请求前被拦截', async () => {
    mocks.createImageBitmap.mockResolvedValue({ width: 20, height: 20, close: vi.fn() });
    const { result } = renderHook(() => useImageUpload({ max: 3 }), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.uploadFiles([imageFile('huge.png')]);
    });

    expect(mocks.message.error).toHaveBeenCalledWith(
      'huge.png：图片像素总数不能超过 100',
    );
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('超过运行时 maxSizeMb 时同样不发请求', async () => {
    mocks.createImageBitmap.mockResolvedValue({ width: 1, height: 1, close: vi.fn() });
    const { result } = renderHook(() => useImageUpload({ max: 3 }), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.uploadFiles([imageFile('big.png', 2 * 1024 * 1024)]);
    });

    expect(mocks.message.error).toHaveBeenCalledWith('big.png：单张图片不能超过 1MB');
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
