import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../admin-ui/providers/ToastProvider';
import { ChannelModelForm } from '../ChannelModelForm';
import { EMPTY_MODEL_DRAFT, type ModelDraft } from '../constants';

vi.mock('../useChannelModels', () => ({
  useProtocolCatalog: () => ({
    options: [{ value: 'openai.images', label: 'Images（openai.images）' }],
    protocols: [
      {
        id: 'openai.images',
        label: 'Images',
        imageParameters: [
          {
            name: 'size',
            label: '尺寸',
            type: 'string',
            encoding: 'pixels',
            values: ['1024x1024', '1536x1024'],
            default: '1024x1024',
            required: true,
          },
        ],
      },
    ],
    loading: false,
  }),
}));

function draft() {
  return {
    ...EMPTY_MODEL_DRAFT,
    modelKey: '  seedream-4.0  ',
    protocol: 'openai.images',
    tiers: [{ ...EMPTY_MODEL_DRAFT.tiers[0], unit: '0.01' }],
  };
}

function renderForm(onSubmit = vi.fn(), overrides: Partial<ModelDraft> = {}) {
  const view = render(
    <ToastProvider>
      <ChannelModelForm
        draft={{ ...draft(), ...overrides }}
        testResult={null}
        testing={false}
        onTest={async () => {}}
        onSubmit={onSubmit}
      />
    </ToastProvider>,
  );
  const form = view.container.querySelector('form');
  if (!form) throw new Error('model form not rendered');
  return { ...view, form, onSubmit };
}

describe('ChannelModelForm', () => {
  it('校验失败时在字段旁提示且不提交', async () => {
    const { form, onSubmit } = renderForm();
    fireEvent.change(screen.getByLabelText('模型编号'), { target: { value: '   ' } });
    fireEvent.submit(form);

    expect(await screen.findByText('请填写模型编号')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('价格档错误显示在价格档区域', async () => {
    const { form, onSubmit } = renderForm();
    fireEvent.change(screen.getByLabelText('方案 1 价格'), { target: { value: 'abc' } });
    fireEvent.submit(form);

    expect(await screen.findByText('价格格式不正确，请填积分，最多 6 位小数')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('提交失败时给出具体字段错误并聚焦首个无效控件', async () => {
    const { form, onSubmit } = renderForm(vi.fn(), {
      protocol: '',
      capabilityConfig: '',
    });
    fireEvent.submit(form);

    expect(await screen.findByTestId('admin-toast')).toHaveTextContent(
      '接口类型：请选择接口类型',
    );
    await waitFor(() => expect(screen.getByLabelText('接口类型')).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('校验通过后把 RHF 当前值交给父级', async () => {
    const { form, onSubmit } = renderForm();
    fireEvent.submit(form);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      modelKey: 'seedream-4.0',
      protocol: 'openai.images',
    });
  });
});
