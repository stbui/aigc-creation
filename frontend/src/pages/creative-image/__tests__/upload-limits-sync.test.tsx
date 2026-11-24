import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UploadLimitsProvider } from '../../../context/UploadLimitsContext';
import { CreativeImageUploadSection } from '../CreativeImageUploadSection';

const settings = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('../../../lib/api-settings', () => ({
  publicSettingsApi: { read: settings.read },
  UPLOAD_LIMITS_CHANGED_EVENT: 'upload-limits:changed',
}));

describe('自由创作上传区运行时限制同步', () => {
  it('后台调小 maxSizeMb 后，accept 与提示文案同步变化', async () => {
    settings.read.mockResolvedValue({
      upload: {
        maxSizeMb: 1,
        maxBytes: 1024 * 1024,
        maxPixels: 1_000_000,
        allowedTypes: 'gif',
        allowedMimes: ['image/gif'],
        allowedLabels: ['GIF'],
      },
    });

    render(
      <UploadLimitsProvider>
        <CreativeImageUploadSection
          images={[]}
          maxImages={1}
          uploading={false}
          onUploadFiles={vi.fn()}
          onRemoveImage={vi.fn()}
          onMoveImage={vi.fn()}
          onOpenLibrary={vi.fn()}
          onOpenMobile={vi.fn()}
        />
      </UploadLimitsProvider>,
    );

    expect(await screen.findByText(/单张不超过 1MB/)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/gif');
  });
});
