import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  uploadMock,
  ensureProjectMock,
  validateImageFileMock,
  isSupportedImageFileMock,
  message,
} = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  ensureProjectMock: vi.fn(),
  validateImageFileMock: vi.fn(),
  isSupportedImageFileMock: vi.fn(),
  message: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../lib/api', () => ({
  assetsApi: { upload: uploadMock },
  assetSrc: (asset?: { signedUrl?: string | null; sourceUrl?: string | null } | null) =>
    asset?.signedUrl ?? asset?.sourceUrl ?? '',
  toAbsoluteUrl: (url?: string | null) => url ?? '',
}));
vi.mock('../useProject', () => ({
  useProject: () => ({ ensureProject: ensureProjectMock }),
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
vi.mock('../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    allowedLabel: 'PNG',
    isSupportedImageFile: isSupportedImageFileMock,
    validateImageFile: validateImageFileMock,
  }),
}));
vi.mock('../../ui', () => ({ useApp: () => ({ message }) }));

import { useImageUpload } from '../useImageUpload';

function imageFile(name: string, type = 'image/png'): File {
  return new File([name], name, { type });
}

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ id: 'asset-1', signedUrl: '/uploads/valid.png' });
  ensureProjectMock.mockReset().mockResolvedValue('project-1');
  validateImageFileMock.mockReset().mockResolvedValue(null);
  isSupportedImageFileMock.mockReset().mockImplementation((file: File) => file.type === 'image/png');
  Object.values(message).forEach((fn) => fn.mockReset());
});

describe('useImageUpload 混选反馈', () => {
  it('合法与非法文件混选时提示忽略项，并且只上传合法文件', async () => {
    const valid = imageFile('valid.png');
    const invalid = imageFile('notes.txt', 'text/plain');
    const { result } = renderHook(() => useImageUpload({ max: 3 }));

    await act(async () => {
      await result.current.uploadFiles([invalid, valid]);
    });

    expect(message.warning).toHaveBeenCalledWith('已忽略不支持的文件，仅支持 PNG');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(valid, 'project-1');
    expect(result.current.images).toEqual([
      { id: 'asset-1', url: '/uploads/valid.png', name: 'valid.png', projectId: 'project-1' },
    ]);
  });

  it('全部合法时保持原有路径，不额外提示忽略项', async () => {
    const valid = imageFile('valid.png');
    const { result } = renderHook(() => useImageUpload({ max: 3 }));

    await act(async () => {
      await result.current.uploadFiles([valid]);
    });

    expect(message.warning).not.toHaveBeenCalledWith('已忽略不支持的文件，仅支持 PNG');
    expect(uploadMock).toHaveBeenCalledWith(valid, 'project-1');
  });
});
