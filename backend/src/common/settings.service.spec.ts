import { describe, expect, it } from 'vitest';

import { SettingsService } from './settings.service';

type RuntimeValue = string | number;

class FakeSettingsService extends SettingsService {
  constructor(private readonly values: Record<string, RuntimeValue>) {
    super({} as never, {} as never);
  }

  override async getNumber(key: string): Promise<number> {
    return Number(this.values[key]);
  }

  override async get<T>(key: string): Promise<T> {
    return this.values[key] as T;
  }
}

describe('SettingsService.uploadLimits', () => {
  it('归一化格式别名并返回与写值一致的上传限制', async () => {
    const service = new FakeSettingsService({
      'upload.maxSizeMb': 24,
      'upload.maxPixels': 12_000_000,
      'upload.allowedTypes': 'webp,jpeg,jpg,png',
    });

    await expect(service.uploadLimits()).resolves.toEqual({
      maxSizeMb: 24,
      maxBytes: 24 * 1024 * 1024,
      maxPixels: 12_000_000,
      allowedTypes: 'jpg,png,webp',
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedLabels: ['JPG', 'PNG', 'WebP'],
    });
  });

  it('把超出部署边界的配置封顶，并为无效格式回落默认白名单', async () => {
    const service = new FakeSettingsService({
      'upload.maxSizeMb': 1_000,
      'upload.maxPixels': 900_000_000,
      'upload.allowedTypes': 'gif',
    });

    const limits = await service.uploadLimits();

    expect(limits.maxSizeMb).toBe(100);
    expect(limits.maxBytes).toBe(100 * 1024 * 1024);
    expect(limits.maxPixels).toBe(200_000_000);
    expect(limits.allowedTypes).toBe('jpg,png,webp');
  });
});
