import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { message, validateImageFileMock, createObjectURLMock, revokeObjectURLMock } = vi.hoisted(
  () => ({
    message: {
      warning: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    },
    validateImageFileMock: vi.fn(),
    createObjectURLMock: vi.fn((_blob: File) => 'blob:first'),
    revokeObjectURLMock: vi.fn(),
  }),
);

vi.mock('../../ui', () => ({
  useApp: () => ({ message }),
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  ImageUploadArea: ({
    images,
    onFiles,
    renderPreview,
  }: {
    images: Array<{ id: string; url: string; name: string }>;
    onFiles: (files: File[]) => void;
    renderPreview?: (images: Array<{ id: string; url: string; name: string }>) => React.ReactNode;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onFiles([
            new File(['first'], 'first.png', { type: 'image/png' }),
            new File(['second'], 'second.png', { type: 'image/png' }),
          ])
        }
      >
        拖入两张图片
      </button>
      {renderPreview?.(images)}
    </div>
  ),
  ImageUploadThumb: ({ item }: { item: { name: string } }) => <span>{item.name}</span>,
  Spinner: () => <span>加载中</span>,
}));

vi.mock('../../hooks/useProject', () => ({
  useProject: () => ({ ensureProject: vi.fn().mockResolvedValue('project-1') }),
}));
vi.mock('../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({
    accept: 'image/png',
    allowedLabel: 'PNG',
    maxMb: 10,
    validateImageFile: validateImageFileMock,
  }),
}));

import { ImageToPromptModal } from '../ImageToPromptModal';

beforeEach(() => {
  validateImageFileMock.mockReset().mockResolvedValue(null);
  Object.values(message).forEach((fn) => fn.mockReset());
  createObjectURLMock.mockClear();
  revokeObjectURLMock.mockClear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURLMock,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURLMock,
  });
});

describe('ImageToPromptModal 单图上传', () => {
  it('一次拖入多张时提示其余文件未采用，并且只使用第一张', async () => {
    render(<ImageToPromptModal open onApply={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '拖入两张图片' }));

    await waitFor(() => expect(screen.getAllByText('first.png').length).toBeGreaterThan(0));
    expect(message.info).toHaveBeenCalledTimes(1);
    expect(message.info).toHaveBeenCalledWith(
      '一次只支持 1 张图片，已使用 first.png，其余 1 张未采用',
    );
    expect(validateImageFileMock).toHaveBeenCalledTimes(1);
    expect(validateImageFileMock.mock.calls[0][0].name).toBe('first.png');
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock.mock.calls[0][0].name).toBe('first.png');
    expect(screen.queryByText('second.png')).toBeNull();
  });
});
