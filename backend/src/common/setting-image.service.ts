import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import {
  assertSafeKey,
  isStorageBackend,
  type StorageBackend,
} from '../storage/storage.provider';
import { SignedUrlService } from './signed-url.service';

const STORAGE_REF_PREFIX = 'storage://';

export interface SettingImageReference {
  backend: StorageBackend;
  key: string;
}

/**
 * 解析系统设置里保存的图片引用。
 *
 * 新上传文件保存为 `storage://<backend>/<key>`，这样切换站点域名不会让
 * 数据库里的地址失效；本地存储在展示时再补 `/uploads/*` HMAC 签名，云存储
 * 则按对应 provider 重新生成有时效的访问地址。历史手工填写的 URL 原样兼容。
 */
export function parseSettingImageReference(
  value: string | null | undefined,
): SettingImageReference | null {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(STORAGE_REF_PREFIX)) return null;
  const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(raw);
  if (!match || !isStorageBackend(match[1])) return null;
  try {
    assertSafeKey(match[2]);
  } catch {
    return null;
  }
  return { backend: match[1], key: match[2] };
}

/** 构造稳定引用；对象 key 不含签名与域名，可安全落库。 */
export function settingImageReference(backend: StorageBackend, key: string): string {
  assertSafeKey(key);
  return `${STORAGE_REF_PREFIX}${backend}/${key}`;
}

/** 系统设置图片的展示地址解析。读取失败返回 null，不阻断整页设置加载。 */
@Injectable()
export class SettingImageService {
  constructor(
    private readonly storage: StorageService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  toReference(backend: StorageBackend, key: string): string {
    return settingImageReference(backend, key);
  }

  async displayUrl(value: string | null | undefined): Promise<string | null> {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    if (raw.startsWith(STORAGE_REF_PREFIX)) {
      const ref = parseSettingImageReference(raw);
      if (!ref) return null;
      const provider = this.storage.get(ref.backend);
      if (!provider) return null;
      try {
        const url = await provider.url(ref.key);
        return provider.backend === 'local'
          ? this.signedUrl.displayUrl(url)
          : url;
      } catch {
        return null;
      }
    }

    return this.signedUrl.displayUrl(raw);
  }
}
