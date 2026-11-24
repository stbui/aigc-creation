import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  file: { current: null as File | null },
}));

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    allowedLabel: 'PNG / JPG',
    isSupportedImageFile: mocks.isSupportedImageFile,
    validateImageFile: mocks.validateImageFile,
  }),
}));

vi.mock('../components', () => ({
  ToolShell: ({
    children,
  }: {
    children: (images: Array<{ id: string; url: string; name: string }>) => React.ReactNode;
  }) => <div>{children([{ id: 'src-1', url: '/uploads/source.png', name: 'source.png' }])}</div>,
}));

vi.mock('../hooks', () => ({
  useApp: () => ({ message: mocks.message }),
  useProject: () => ({ ensureProject: mocks.ensureProject }),
  useToolHistory: () => ({ tasks: [], loading: false, error: null, retry: vi.fn() }),
  useToolTask: () => ({ submitting: false, result: null, run: vi.fn() }),
}));

vi.mock('../api', () => ({
  assetsApi: { upload: mocks.upload },
  assetSrc: () => '/uploads/reference.png',
}));

vi.mock('../LocalRedrawAnnotationPanel', () => ({
  LocalRedrawAnnotationPanel: ({
    onUploadReference,
  }: {
    onUploadReference: (id: number, file: File | undefined) => void;
  }) => (
    <button type="button" onClick={() => onUploadReference(1, mocks.file.current ?? undefined)}>
      上传标注参考图
    </button>
  ),
}));

vi.mock('../LocalRedrawHistoryPane', () => ({ LocalRedrawHistoryPane: () => null }));
vi.mock('../LocalRedrawIntro', () => ({ LocalRedrawIntro: () => null }));
vi.mock('../LocalRedrawStage', () => ({ LocalRedrawStage: () => null }));
vi.mock('../LocalRedrawUploadPreview', () => ({ LocalRedrawUploadPreview: () => null }));

import { LocalRedrawPage } from '../page';

function imageFile(name: string): File {
  return new File(['image'], name, { type: 'image/png' });
}

describe('局部重绘标注参考图运行时限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProject.mockResolvedValue('project-1');
    mocks.isSupportedImageFile.mockReturnValue(true);
  });

  it('像素超限时在创建项目和上传请求前被拦截', async () => {
    mocks.validateImageFile.mockResolvedValueOnce('图片像素总数不能超过 1,000,000');
    mocks.file.current = imageFile('huge.png');
    render(<LocalRedrawPage />);

    fireEvent.click(screen.getByRole('button', { name: '上传标注参考图' }));

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('图片像素总数不能超过 1,000,000'),
    );
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('类型不支持时以 warning 提示，且不发请求', async () => {
    mocks.isSupportedImageFile.mockReturnValueOnce(false);
    mocks.file.current = new File(['x'], 'notes.txt', { type: 'text/plain' });
    render(<LocalRedrawPage />);

    fireEvent.click(screen.getByRole('button', { name: '上传标注参考图' }));

    await waitFor(() =>
      expect(mocks.message.warning).toHaveBeenCalledWith('请选择图片文件（PNG / JPG）'),
    );
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
