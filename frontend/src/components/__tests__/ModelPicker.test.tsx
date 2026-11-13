import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelPicker } from '../ModelPicker';
import { loadModels, type PublicModelGroup } from '../../lib/models';

vi.mock('../../lib/models', async () => {
  const actual = await vi.importActual<typeof import('../../lib/models')>('../../lib/models');
  return { ...actual, loadModels: vi.fn() };
});

const imageModel: PublicModelGroup = {
  id: 'main_image:main-image',
  modelKey: 'main-image',
  name: '仿真图像·main_image',
  icon: '',
  description: '',
  capability: 'main_image',
  sortOrder: 0,
  displayPrice: 10,
  priceLabel: '10 积分',
  billingMode: 'fixed_request',
  capabilitySpec: {
    version: 1,
    capability: 'image',
    inputs: { image: { min: 1, max: 4 } },
  },
  supplyCount: 1,
  available: true,
};

const redrawModelWithoutMask: PublicModelGroup = {
  ...imageModel,
  id: 'local_redraw:redraw-image-only',
  modelKey: 'redraw-image-only',
  name: '仿真图像·不支持遮罩',
  capability: 'local_redraw',
  sortOrder: 0,
};

const redrawModelWithMask: PublicModelGroup = {
  ...imageModel,
  id: 'local_redraw:redraw-mask',
  modelKey: 'redraw-mask',
  name: '仿真图像·支持遮罩',
  capability: 'local_redraw',
  sortOrder: 1,
  capabilitySpec: {
    version: 1,
    capability: 'image',
    inputs: { image: { min: 1, max: 4 }, mask: { min: 0, max: 1 } },
  },
};

describe('ModelPicker 模型输入能力上报', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(loadModels).mockResolvedValue([imageModel]);
  });

  it('目录加载后把真实选中的模型交给页面读取能力上限', async () => {
    const onModelChange = vi.fn();
    render(
      <ModelPicker
        capability="main_image"
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() => expect(onModelChange).toHaveBeenLastCalledWith(imageModel));
  });

  it('声明本次需要遮罩时跳过不具备 mask 合同的可用模型', async () => {
    vi.mocked(loadModels).mockResolvedValue([redrawModelWithoutMask, redrawModelWithMask]);
    const onModelChange = vi.fn();
    render(
      <ModelPicker
        capability="local_redraw"
        requiredInputs={['mask']}
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() => expect(onModelChange).toHaveBeenLastCalledWith(redrawModelWithMask));
  });
});
