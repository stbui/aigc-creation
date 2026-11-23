import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadSpec } from '../../components/toolShellTypes';
import type { Asset } from '../../types/api';

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
vi.mock('../useProject', () => ({
  useProject: () => ({ ensureProject: ensureProjectMock }),
}));
vi.mock('../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    accept: 'image/png',
    allowedLabel: 'PNG',
    isSupportedImageFile: isSupportedImageFileMock,
    validateImageFile: validateImageFileMock,
  }),
}));
vi.mock('../../ui', () => ({ useApp: () => ({ message }) }));

import { useToolUploadSlots } from '../useToolUploadSlots';

const upload: UploadSpec = {
  title: '测试图片',
  max: 1,
  hint: '',
};

function imageFile(name: string): File {
  return new File([name], name, { type: 'image/png' });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderSlots(options: { replaceUpload?: boolean; max?: number } = {}) {
  return renderHook(() =>
    useToolUploadSlots({
      upload: { ...upload, max: options.max ?? upload.max },
      replaceUpload: options.replaceUpload,
    }),
  );
}

beforeEach(() => {
  uploadMock.mockReset();
  ensureProjectMock.mockReset().mockResolvedValue('project-1');
  validateImageFileMock.mockReset().mockResolvedValue(null);
  isSupportedImageFileMock.mockReset().mockReturnValue(true);
  Object.values(message).forEach((fn) => fn.mockReset());
});

describe('useToolUploadSlots 上传互斥', () => {
  it('max=1 连续触发两次时只发出首个请求，最终只保留一张图', async () => {
    const pending = deferred<{ id: string; signedUrl: string }>();
    uploadMock.mockReturnValueOnce(pending.promise);
    const { result } = renderSlots();

    let firstUpload!: Promise<void>;
    act(() => {
      firstUpload = result.current.uploadFiles([imageFile('first.png')]);
    });
    await waitFor(() => expect(result.current.uploading).toBe(true));

    await act(async () => {
      await result.current.uploadFiles([imageFile('second.png')]);
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(message.info).toHaveBeenCalledWith('正在上传上一批图片，请稍候');

    await act(async () => {
      pending.resolve({ id: 'asset-1', signedUrl: '/uploads/first.png' });
      await firstUpload;
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.images).toEqual([
      { id: 'asset-1', url: '/uploads/first.png', name: 'first.png' },
    ]);
  });

  it('成功后释放锁，第二批可以正常上传并替换单图', async () => {
    uploadMock
      .mockResolvedValueOnce({ id: 'asset-1', signedUrl: '/uploads/first.png' })
      .mockResolvedValueOnce({ id: 'asset-2', signedUrl: '/uploads/second.png' });
    const { result } = renderSlots({ replaceUpload: true });

    await act(async () => {
      await result.current.uploadFiles([imageFile('first.png')]);
    });
    await act(async () => {
      await result.current.uploadFiles([imageFile('second.png')]);
    });

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(result.current.uploading).toBe(false);
    expect(result.current.images).toEqual([
      { id: 'asset-2', url: '/uploads/second.png', name: 'second.png' },
    ]);
  });

  it('上传异常后释放锁，第二批可以重试成功', async () => {
    uploadMock
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({ id: 'asset-1', signedUrl: '/uploads/retry.png' });
    const { result } = renderSlots();

    await act(async () => {
      await result.current.uploadFiles([imageFile('retry.png')]);
    });
    expect(message.error).toHaveBeenCalledWith('网络断开');
    expect(result.current.uploading).toBe(false);

    await act(async () => {
      await result.current.uploadFiles([imageFile('retry.png')]);
    });

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(result.current.images).toEqual([
      { id: 'asset-1', url: '/uploads/retry.png', name: 'retry.png' },
    ]);
  });

  it('校验失败后释放锁，修正校验结果即可再次上传', async () => {
    validateImageFileMock.mockResolvedValueOnce('图片过大').mockResolvedValueOnce(null);
    uploadMock.mockResolvedValueOnce({ id: 'asset-1', signedUrl: '/uploads/valid.png' });
    const { result } = renderSlots();

    await act(async () => {
      await result.current.uploadFiles([imageFile('valid.png')]);
    });
    expect(message.error).toHaveBeenCalledWith('valid.png：图片过大');
    expect(uploadMock).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);

    await act(async () => {
      await result.current.uploadFiles([imageFile('valid.png')]);
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(result.current.images).toEqual([
      { id: 'asset-1', url: '/uploads/valid.png', name: 'valid.png' },
    ]);
  });

  it('上传进行中拒绝素材库和手机回填，不改变正常多选规则', async () => {
    const pending = deferred<{ id: string; signedUrl: string }>();
    uploadMock.mockReturnValueOnce(pending.promise);
    const { result } = renderSlots();

    let firstUpload!: Promise<void>;
    act(() => {
      firstUpload = result.current.uploadFiles([imageFile('first.png')]);
    });
    await waitFor(() => expect(result.current.uploading).toBe(true));

    let accepted = true;
    act(() => {
      accepted = result.current.pickFromLibrary({
        id: 'library-1',
        sourceUrl: '/uploads/library.png',
      } as Asset);
      result.current.addMobileAssets([
        { id: 'mobile-1', url: '/uploads/mobile.png', filename: 'mobile.png' },
      ]);
    });

    expect(accepted).toBe(false);
    expect(message.info).toHaveBeenCalledTimes(2);
    expect(message.info).toHaveBeenCalledWith('正在上传上一批图片，请稍候');

    await act(async () => {
      pending.resolve({ id: 'asset-1', signedUrl: '/uploads/first.png' });
      await firstUpload;
    });

    expect(result.current.images).toEqual([
      { id: 'asset-1', url: '/uploads/first.png', name: 'first.png' },
    ]);
  });
});
