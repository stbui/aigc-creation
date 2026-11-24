import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityDef } from '../../../types/api';
import type { FormInstance } from '../../../ui';
import { useToolPageTask } from '../hooks';

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
  isSupportedImageFile: vi.fn(),
}));

vi.mock('../../../ui', () => ({
  useApp: () => ({ message: mocks.message }),
}));

vi.mock('../../../hooks/useProject', () => ({
  useProject: () => ({ ensureProject: mocks.ensureProject }),
}));
vi.mock('../../../hooks/useCreditLabel', () => ({ useCreditLabel: () => null }));
vi.mock('../../../hooks/useGenerateError', () => ({
  useGenerateError: () => vi.fn(),
}));
vi.mock('../../../hooks/usePollAbort', () => ({ usePollAbort: () => undefined }));
vi.mock('../../../hooks/useAssetLibrary', () => ({
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

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    allowedLabel: 'PNG / JPG',
    isSupportedImageFile: mocks.isSupportedImageFile,
    validateImageFile: mocks.validateImageFile,
  }),
}));
vi.mock('../../../context/CreditsContext', () => ({
  notifyCreditsChanged: vi.fn(),
}));

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {},
  assetSrc: () => '',
  assetThumbSrc: () => '',
  assetsApi: { upload: mocks.upload },
  generateApi: { start: vi.fn() },
  newIdempotencyKey: () => 'idem-test',
  resolveModelKey: () => 'model-1',
}));
vi.mock('../utils', () => ({
  taskErrorText: () => '',
  waitForTask: vi.fn(),
}));

const def = {
  id: 'test-capability',
  inputs: 1,
  defaultParams: {},
  params: [],
} as unknown as CapabilityDef;

const form = { reset: vi.fn() } as unknown as FormInstance;

describe('通用工具页上传运行时限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProject.mockResolvedValue('project-1');
    mocks.isSupportedImageFile.mockReturnValue(true);
  });

  it('像素超限时 onSelect 返回 false，且不发建项目与上传请求', async () => {
    mocks.validateImageFile.mockResolvedValueOnce('图片像素总数不能超过 1,000,000');
    const { result } = renderHook(() => useToolPageTask(def, form));
    const file = new File(['image'], 'huge.png', { type: 'image/png' });

    let accepted = true;
    await act(async () => {
      accepted = await result.current.onSelect(file);
    });

    expect(accepted).toBe(false);
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith(
      'huge.png：图片像素总数不能超过 1,000,000',
    );
  });

  it('类型不支持时以 warning 提示，且不发请求', async () => {
    mocks.isSupportedImageFile.mockReturnValueOnce(false);
    const { result } = renderHook(() => useToolPageTask(def, form));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.onSelect(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    });

    expect(accepted).toBe(false);
    expect(mocks.message.warning).toHaveBeenCalledWith('请选择图片文件（PNG / JPG）');
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
