import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type { StorageObject, StorageProvider } from './storage.contract';
import { assertSafeKey, publicObjectUrl } from './storage.utils';

/** 本地磁盘后端。 */
export class LocalStorageProvider implements StorageProvider {
  readonly backend = 'local' as const;

  constructor(
    private readonly root = resolve(process.cwd(), 'uploads'),
    private readonly publicPrefix = '/uploads',
    /** 对外根地址；配置后页面拿到绝对地址，便于 CDN / 反代场景 */
    private readonly publicBaseUrl?: string,
  ) {}

  private abs(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    // 双保险: 即使 assertSafeKey 被绕过, 仍校验解析后路径在 root 内
    if (!full.startsWith(this.root + '/')) throw new Error('非法存储 key');
    return full;
  }

  async url(key: string): Promise<string> {
    assertSafeKey(key);
    if (this.publicBaseUrl) return publicObjectUrl(this.publicBaseUrl, key);
    return `${this.publicPrefix}/${key}`;
  }

  async put(key: string, data: Buffer): Promise<StorageObject> {
    const full = this.abs(key);
    await fs.mkdir(join(full, '..'), { recursive: true });
    await fs.writeFile(full, data);
    return { key, sizeBytes: data.byteLength, contentType: 'application/octet-stream' };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.abs(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.abs(key)).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.abs(key));
  }

  async probe() {
    const t0 = Date.now();
    try {
      await fs.mkdir(this.root, { recursive: true });
      // 实写一个探针文件再删 —— 只检查目录可访问不足以证明可写
      const probeKey = `.probe-${Date.now()}`;
      await this.put(probeKey, Buffer.from('ok'));
      await this.delete(probeKey);
      return { ok: true, message: `可读可写: ${this.root}`, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, message: `不可写: ${(e as Error).message}（${this.root}）` };
    }
  }

  credentialStatus() {
    return {
      configured: true,
      endpoint: this.publicBaseUrl ? `${this.root} → ${this.publicBaseUrl}` : this.root,
    };
  }
}