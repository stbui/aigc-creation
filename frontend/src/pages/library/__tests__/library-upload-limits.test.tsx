import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProject: vi.fn(),
  upload: vi.fn(),
  load: vi.fn(),
  refreshProjects: vi.fn(),
  message: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  validateImageFile: vi.fn(),
  isSupportedImageFile: vi.fn(),
  files: { current: [] as File[] },
}));

vi.mock('../../../ui', () => ({
  useApp: () => ({ message: mocks.message }),
}));

vi.mock('../hooks', () => ({
  useApp: () => ({ message: mocks.message }),
  useAuth: () => ({ token: 'token-1', openLogin: vi.fn() }),
  useCapabilities: () => ({ data: { items: [] } }),
  useDocumentMeta: vi.fn(),
  useProject: () => ({ ensureProject: mocks.ensureProject }),
  useImageUploadArea: (options: { onFiles: (files: File[]) => void }) => ({
    inputRef: { current: null },
    open: vi.fn(),
    onInputChange: (files: File[]) => options.onFiles(files),
  }),
  useLightboxIndex: () => ({
    index: 0,
    setIndex: vi.fn(),
    indexById: new Map<string, number>(),
  }),
}));

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    accept: 'image/png',
    allowedLabel: 'PNG',
    isSupportedImageFile: mocks.isSupportedImageFile,
    validateImageFile: mocks.validateImageFile,
  }),
}));

vi.mock('../api', () => ({
  assetsApi: { upload: mocks.upload, delete: vi.fn(), download: vi.fn() },
  assetSrc: (asset?: { signedUrl?: string | null; sourceUrl?: string | null }) =>
    asset?.signedUrl ?? asset?.sourceUrl ?? '',
  projectsApi: { list: vi.fn() },
}));

vi.mock('../useLibraryAssets', () => ({
  useLibraryAssets: () => ({
    items: [],
    setItems: vi.fn(),
    loading: false,
    error: null,
    load: mocks.load,
  }),
}));
vi.mock('../useLibraryProjects', () => ({
  useLibraryProjects: () => ({ projects: [], refreshProjects: mocks.refreshProjects }),
}));
vi.mock('../useLibraryGroups', () => ({
  useLibraryGroups: () => ({
    groupBy: 'project',
    setGroupBy: vi.fn(),
    groupKey: null,
    setGroupKey: vi.fn(),
    projectIdParam: null,
    setProjectParam: vi.fn(),
    selectProjectGroup: vi.fn(),
    groups: [],
    activeGroup: null,
    selectedProjectId: null,
    activeProject: null,
    moveTargetProjects: [],
    shown: [],
  }),
}));
vi.mock('../useInfiniteScroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}));

vi.mock('../components', () => ({
  ImageLightbox: () => null,
  MobileUploadModal: () => null,
  modalityOfFormat: () => 'image',
  ImageUploadInput: ({ onChange }: { onChange: (files: File[]) => void }) => (
    <button type="button" onClick={() => onChange(mocks.files.current)}>
      上传素材
    </button>
  ),
}));

vi.mock('../LibraryToolbar', () => ({ LibraryToolbar: () => null }));
vi.mock('../LibraryGroupPanel', () => ({ LibraryGroupPanel: () => null }));
vi.mock('../LibraryBatchBar', () => ({ LibraryBatchBar: () => null }));
vi.mock('../LibraryGrid', () => ({ LibraryGrid: () => null }));
vi.mock('../LibraryLoadingState', () => ({ LibraryLoadingState: () => null }));
vi.mock('../LibraryErrorState', () => ({ LibraryErrorState: () => null }));
vi.mock('../LibraryEmptyState', () => ({ LibraryEmptyState: () => null }));
vi.mock('../LibraryMoveAssetsDialog', () => ({ LibraryMoveAssetsDialog: () => null }));
vi.mock('../LibraryProjectManagerDialog', () => ({
  LibraryProjectManagerDialog: () => null,
}));

import { LibraryPage } from '../page';

function imageFile(name: string): File {
  return new File(['image'], name, { type: 'image/png' });
}

describe('素材库上传运行时限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProject.mockResolvedValue('project-1');
    mocks.upload.mockResolvedValue({ id: 'asset-1', signedUrl: '/uploads/uploaded.png' });
    mocks.load.mockResolvedValue(undefined);
    mocks.refreshProjects.mockResolvedValue(undefined);
    mocks.isSupportedImageFile.mockImplementation((file: File) => file.type === 'image/png');
    mocks.validateImageFile.mockResolvedValue(null);
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      writable: true,
      value: vi.fn(async () => ({ close: vi.fn() })),
    });
  });

  it('像素超限时在创建项目和上传请求前被拦截', async () => {
    mocks.validateImageFile.mockResolvedValueOnce('图片像素总数不能超过 1,000,000');
    mocks.files.current = [imageFile('huge.png')];
    render(<LibraryPage />);

    fireEvent.click(screen.getByRole('button', { name: '上传素材' }));

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('图片像素总数不能超过 1,000,000'),
    );
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('混选非图片时只上传合法项并提示忽略，不整批拒绝', async () => {
    mocks.files.current = [
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
      imageFile('valid.png'),
    ];
    render(<LibraryPage />);

    fireEvent.click(screen.getByRole('button', { name: '上传素材' }));

    await waitFor(() => expect(mocks.message.success).toHaveBeenCalledWith('已上传 1 张素材'));
    expect(mocks.message.warning).toHaveBeenCalledWith('已忽略 1 个非图片文件');
    expect(mocks.message.error).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ name: 'valid.png' });
  });
});
