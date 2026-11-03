import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelPicker } from '../ModelPicker';
import { loadModels, type PublicLogicalModel } from '../../lib/models';

vi.mock('../../lib/models', async () => {
  const actual = await vi.importActual<typeof import('../../lib/models')>('../../lib/models');
  return { ...actual, loadModels: vi.fn() };
});

const imageModel: PublicLogicalModel = {
  id: 'model-main-image',
  code: 'main-image',
  name: '仿真图像·main_image',
  icon: '',
  description: '',
  capability: 'main_image',
  sortOrder: 0,
  pricePolicy: 'fixed',
  pricingMode: 'fixed',
  displayPrice: 10,
  priceLabel: '10 积分',
  billingMode: 'per_image',
  unitPriceMicrocredits: 10_000_000,
  inputPriceMicrocredits: 0,
  outputPriceMicrocredits: 0,
  cachedPriceMicrocredits: 0,
  priceTiers: [],
  legacyModelIds: [],
  capabilitySpec: {
    version: 1,
    capability: 'image',
    inputs: { image: { min: 1, max: 4 } },
  },
  capabilityProfiles: [],
  defaultOptions: {},
  available: true,
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
});
