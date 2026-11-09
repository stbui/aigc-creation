import { describe, expect, it, vi } from 'vitest';
import {
  SettingImageService,
  parseSettingImageReference,
  settingImageReference,
} from './setting-image.service';

describe('setting image reference', () => {
  it('构造并解析带存储后端的稳定引用', () => {
    const value = settingImageReference('local', 'settings/202611/help.png');
    expect(value).toBe('storage://local/settings/202611/help.png');
    expect(parseSettingImageReference(value)).toEqual({
      backend: 'local',
      key: 'settings/202611/help.png',
    });
  });

  it('拒绝未知后端与目录穿越', () => {
    expect(parseSettingImageReference('storage://unknown/settings/a.png')).toBeNull();
    expect(parseSettingImageReference('storage://local/../secret.png')).toBeNull();
  });
});

describe('SettingImageService', () => {
  it('本地引用通过 SignedUrlService 生成签名地址', async () => {
    const provider = {
      backend: 'local',
      url: vi.fn().mockResolvedValue('/uploads/settings/help.png'),
    };
    const storage = { get: vi.fn().mockReturnValue(provider) };
    const signedUrl = {
      displayUrl: vi.fn((value: string) => `signed:${value}`),
    };
    const service = new SettingImageService(storage as never, signedUrl as never);

    await expect(
      service.displayUrl('storage://local/settings/help.png'),
    ).resolves.toBe('signed:/uploads/settings/help.png');
    expect(storage.get).toHaveBeenCalledWith('local');
    expect(provider.url).toHaveBeenCalledWith('settings/help.png');
  });

  it('云存储引用使用 provider 重新生成访问地址', async () => {
    const provider = {
      backend: 'oss',
      url: vi.fn().mockResolvedValue('https://oss.example.com/settings/help.png?sign=1'),
    };
    const storage = { get: vi.fn().mockReturnValue(provider) };
    const signedUrl = { displayUrl: vi.fn() };
    const service = new SettingImageService(storage as never, signedUrl as never);

    await expect(
      service.displayUrl('storage://oss/settings/help.png'),
    ).resolves.toBe('https://oss.example.com/settings/help.png?sign=1');
    expect(signedUrl.displayUrl).not.toHaveBeenCalled();
  });

  it('历史外链原样交给签名服务处理', async () => {
    const storage = { get: vi.fn() };
    const signedUrl = {
      displayUrl: vi.fn().mockReturnValue('https://cdn.example.com/help.png'),
    };
    const service = new SettingImageService(storage as never, signedUrl as never);

    await expect(service.displayUrl('https://cdn.example.com/help.png')).resolves.toBe(
      'https://cdn.example.com/help.png',
    );
  });
});
