import { describe, expect, it, vi } from 'vitest';

import { SettingsController } from './settings.controller';
import type { SettingsService, UploadLimits } from './settings.service';

describe('SettingsController', () => {
  it('公开接口只返回上传域，不转发其他后台配置', async () => {
    const upload: UploadLimits = {
      maxSizeMb: 20,
      maxBytes: 20 * 1024 * 1024,
      maxPixels: 40_000_000,
      allowedTypes: 'jpg,png,webp',
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedLabels: ['JPG', 'PNG', 'WebP'],
    };
    const settings = {
      uploadLimits: vi.fn().mockResolvedValue(upload),
      getAll: vi.fn().mockResolvedValue({ 'payment.enabled': true }),
    };
    const controller = new SettingsController(settings as unknown as SettingsService);

    await expect(controller.read()).resolves.toEqual({ upload });
    expect(settings.uploadLimits).toHaveBeenCalledOnce();
    expect(settings.getAll).not.toHaveBeenCalled();
  });
});
