import { randomBytes } from 'node:crypto';

/**
 * 生成产物的内存文件仓。
 *
 * 为什么内存而不是磁盘：这个网关是联调工具，产物随时可重新生成；
 * 落盘会留下垃圾且需要处理权限。内存仓按 TTL + 总字节上限淘汰，
 * 避免长时间运行把开发机吃满。
 */
export class AssetStore {
  /**
   * @param {{ ttlMs?: number, maxBytes?: number }} [opts]
   */
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    this.maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
    /** @type {Map<string, {id:string,mime:string,ext:string,buffer:Buffer,size:number,createdAt:number,lastAccess:number,meta:object}>} */
    this.files = new Map();
    this.totalBytes = 0;
    this.timer = setInterval(() => this.cleanup(), 60_000);
    this.timer.unref?.();
  }

  /**
   * @param {Buffer} buffer
   * @param {{ mime: string, ext: string, meta?: object }} opts
   * @returns {{ id: string, urlPath: string }}
   */
  put(buffer, opts) {
    const id = `file_${randomBytes(9).toString('hex')}`;
    const ext = opts.ext.replace(/^\./, '');
    const entry = {
      id,
      mime: opts.mime,
      ext,
      buffer,
      size: buffer.length,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      meta: opts.meta ?? {},
    };
    this.files.set(id, entry);
    this.totalBytes += buffer.length;
    this.evictIfNeeded();
    return { id, urlPath: `/files/${id}.${ext}` };
  }

  get(id) {
    const entry = this.files.get(id);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.remove(id);
      return null;
    }
    entry.lastAccess = Date.now();
    return entry;
  }

  remove(id) {
    const entry = this.files.get(id);
    if (!entry) return false;
    this.files.delete(id);
    this.totalBytes -= entry.size;
    return true;
  }

  cleanup(now = Date.now()) {
    for (const [id, entry] of this.files) {
      if (now - entry.createdAt > this.ttlMs) this.remove(id);
    }
  }

  evictIfNeeded() {
    // Map 的插入顺序即创建顺序：从最老的开始删。
    while (this.totalBytes > this.maxBytes && this.files.size > 0) {
      const oldest = this.files.keys().next().value;
      this.remove(oldest);
    }
  }

  stats() {
    return {
      files: this.files.size,
      bytes: this.totalBytes,
      maxBytes: this.maxBytes,
      ttlMs: this.ttlMs,
    };
  }

  dispose() {
    clearInterval(this.timer);
    this.files.clear();
    this.totalBytes = 0;
  }
}
