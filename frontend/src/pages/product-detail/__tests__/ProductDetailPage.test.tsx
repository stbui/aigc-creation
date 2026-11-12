import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductDetailPage } from '../page';
import { startDetailGeneration } from '../api';

vi.mock('../../../ui', async () => {
  const { forwardRef } = await import('react');
  const passthrough = forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => (
    <div ref={ref as never} {...props} />
  ));
  const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, ...props }, ref) => (
      <button ref={ref} {...props}>
        {children}
      </button>
    ),
  );
  const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  );
  const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    (props, ref) => <textarea ref={ref} {...props} />,
  );
  return {
    useApp: () => ({
      message: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
    Button,
    Input,
    Textarea,
    Modal: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
    Card: passthrough,
  };
});

vi.mock('../hooks', async () => {
  const { useState } = await import('react');
  return {
    notifyCreditsChanged: vi.fn(),
    useAuth: () => ({ token: null }),
    useCapabilityRuntime: () => ({ blocked: false, reason: '' }),
    useDetailCreditLabel: () => '本次消耗 20 积分',
    useGenerateError: () => vi.fn(),
    useImageUpload: () => ({
      images: [{ id: 'asset-1', url: '/uploads/probe.png', name: 'probe.png' }],
      uploading: false,
      fileInputRef: { current: null },
      uploadFiles: vi.fn(),
      removeImage: vi.fn(),
      replaceImages: vi.fn(),
      library: {
        open: false,
        loading: false,
        items: [],
        error: null,
        openLibrary: vi.fn(),
        closeLibrary: vi.fn(),
        pick: vi.fn(),
      },
      mobile: { open: false, openMobile: vi.fn(), closeMobile: vi.fn(), addAssets: vi.fn() },
    }),
    useProject: () => ({ ensureProject: vi.fn(async () => 'project-1') }),
    useResultGallery: () => ({
      items: [],
      loading: false,
      error: null,
      reload: vi.fn(async () => undefined),
      removeItem: vi.fn(),
    }),
    useRightTab: () => ({ rightTab: 'demo', pick: vi.fn(), showResults: vi.fn() }),
    useSectionSelection: () => {
      const [sections] = useState(['hero', 'selling_points']);
      return {
        sections,
        toggle: vi.fn(),
        applySelection: vi.fn(),
      };
    },
  };
});

vi.mock('../components', () => ({
  AssetLibraryModal: () => null,
  MobileUploadModal: () => null,
  ModelPicker: () => null,
  OutputTabsPane: () => null,
  ToolImageDropzone: () => <div>上传商品图</div>,
  ToolSettingsPopover: () => null,
  ToolSubmitBar: ({
    disabled,
    label,
    onSubmit,
  }: {
    disabled?: boolean;
    label: string;
    onSubmit: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onSubmit}>
      {label}
    </button>
  ),
  ToolWorkflowSteps: () => null,
}));

vi.mock('../DetailExamplePanel', () => ({ DetailExamplePanel: () => null }));
vi.mock('../DetailResultList', () => ({ DetailResultList: () => null }));
vi.mock('../DetailSectionPicker', () => ({ DetailSectionPicker: () => null }));
vi.mock('../DetailSelectField', () => ({ DetailSelectField: () => null }));

vi.mock('../api', () => ({
  DETAIL_CAPABILITY: 'detail_image',
  analyzeImageToPrompt: vi.fn(),
  newIdempotencyKey: () => 'idem-test',
  removeDetailGeneration: vi.fn(),
  resolveModelId: vi.fn(async () => 'model-1'),
  startDetailGeneration: vi.fn(async () => ({
    taskId: 'task-1',
    status: 'queued',
    creditCost: 20,
    idempotentHit: false,
    batchId: 'batch-1',
    batchSize: 2,
  })),
}));

describe('ProductDetailPage 模块提示词接线', () => {
  beforeEach(() => {
    vi.mocked(startDetailGeneration).mockClear();
  });

  it('页面不展示各模块画面要求，也不再发送重复的前端默认提示词', async () => {
    render(
      <MemoryRouter>
        <ProductDetailPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText('各模块画面要求')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '首屏主视觉画面要求' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('* 请输入商品名称'), {
      target: { value: '探针商品' },
    });
    fireEvent.change(screen.getByPlaceholderText('* 请输入商品描述'), {
      target: { value: '商品描述' },
    });
    fireEvent.click(screen.getByRole('button', { name: '立即生成' }));

    await waitFor(() => expect(startDetailGeneration).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startDetailGeneration).mock.calls[0][0]).toMatchObject({
      sections: ['hero', 'selling_points'],
    });
    expect(vi.mocked(startDetailGeneration).mock.calls[0][0]).not.toHaveProperty('sectionPrompts');
  });
});
