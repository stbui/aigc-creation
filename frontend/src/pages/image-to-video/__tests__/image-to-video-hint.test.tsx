import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageToVideoPage } from '../page';

const { runtimeLabel } = vi.hoisted(() => ({ runtimeLabel: 'AVIF / PNG' }));

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({ allowedLabel: runtimeLabel }),
}));

vi.mock('../components', () => ({
  ToolShell: ({ upload }: { upload: { hint?: string } }) => (
    <div data-testid="upload-hint">{upload.hint}</div>
  ),
}));

vi.mock('../VideoResultPane', () => ({ VideoResultPane: () => null }));
vi.mock('../VideoSettingsCard', () => ({ VideoSettingsCard: () => null }));
vi.mock('../VideoUploadPreview', () => ({ VideoUploadPreview: () => null }));
vi.mock('../hooks', () => ({
  useCapabilities: () => ({ data: null, loading: false, error: null }),
  useToolTask: () => ({ submitting: false, result: null, run: vi.fn() }),
}));

describe('image-to-video upload hint', () => {
  it('使用运行时 allowedLabel 而不是固定格式列表', () => {
    render(<ImageToVideoPage />);
    const hint = screen.getByTestId('upload-hint').textContent ?? '';
    expect(hint).toContain(runtimeLabel);
    expect(hint).toContain('最多 1 张');
    expect(hint).not.toContain('JPG');
  });
});
