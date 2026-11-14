import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import {
  LocalStorageProvider,
  OssStorageProvider,
  MinioStorageProvider,
  STORAGE_BACKENDS,
  isSdkInstalled,
  isStorageBackend,
  maskSecret,
  type StorageBackend,
  type StorageProvider,
} from './storage.provider';

export interface BackendStatus {
  backend: StorageBackend;
  available: boolean;
  /** 该后端是否配置完整 (凭据齐全) */
  configured: boolean;
  /** 是否为当前默认后端 */
  active: boolean;
  /** 凭据脱敏值, 永不返回明文 (B-63) */
  masked?: string;
  endpoint?: string;
  probeMessage?: string;
  probeLatencyMs?: number;
}

/**
 * 存储工厂。
 *
 * 后端选择优先级:
 *   STORAGE_BACKEND 环境变量 > 缺省local
 *
 * 配置自检在启动时跑一遍并打WARN —— 配错了要在启动日志里就能看到,
 * 而不是等到用户上传失败才发现。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private providers = new Map<StorageBackend, StorageProvider>();
  private active: StorageBackend = 'local';

  constructor(private readonly config: ConfigService) {
    /*
     * 不能把 process.env 直接 as 成 StorageBackend: 拼错一个字母就会得到一个
     * map 里根本不存在的 active，启动时一切正常、第一次上传才炸。这里显式
     * 收窄（与 env.validation.ts 的 oneOf 同一份白名单），非法值当场报错。
     */
    const raw = process.env.STORAGE_BACKEND;
    if (raw && !isStorageBackend(raw)) {
      this.logger.error(`STORAGE_BACKEND 非法: ${raw}（可选 local/oss/minio），已回落 local`);
      this.active = 'local';
    } else {
      this.active = raw ?? 'local';
    }

    // 本地根目录取自 UPLOAD_DIR: 三环境必须各写各的目录, 否则 test 跑一次
    // 「删除任务」就会连带删掉开发环境正在用的素材图, 且不留任何痕迹。
    this.register(new LocalStorageProvider(this.resolveUploadsDir()));

    // 按需构造: 凭据**齐全**才实例化, 半配置状态不进 map。
    // 这样 require('ali-oss') / require('minio') 根本不会执行 —— 本地开发零云依赖。
    if (this.requiredEnv('oss').length === 0) {
      try {
        this.register(
          new OssStorageProvider({
            region: process.env.OSS_REGION!,
            bucket: process.env.OSS_BUCKET!,
            accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
            endpoint: process.env.OSS_ENDPOINT,
          }),
        );
      } catch (e) {
        this.logger.error(
          `OSS 初始化失败(将被忽略): ${(e as Error).message}${this.sdkHint('ali-oss')}`,
        );
      }
    }

    if (this.requiredEnv('minio').length === 0) {
      try {
        this.register(
          new MinioStorageProvider({
            endPoint: process.env.MINIO_ENDPOINT!,
            port: Number(process.env.MINIO_PORT ?? 9000),
            useSSL: process.env.MINIO_USE_SSL === 'true',
            accessKey: process.env.MINIO_ACCESS_KEY!,
            secretKey: process.env.MINIO_SECRET_KEY!,
            bucket: process.env.MINIO_BUCKET ?? 'huojue',
          }),
        );
      } catch (e) {
        this.logger.error(
          `MinIO 初始化失败(将被忽略): ${(e as Error).message}${this.sdkHint('minio')}`,
        );
      }
    }
  }

  /**
   * 启用云端后端的必需变量。有默认值（MINIO_PORT / MINIO_BUCKET / MINIO_USE_SSL）
   * 或可选（OSS_ENDPOINT）的项不在此列 —— 列进去会让「已经能用了」显示成「还差配置」。
   */
  private requiredEnv(backend: 'oss' | 'minio'): string[] {
    const candidates: Record<string, string | undefined> =
      backend === 'oss'
        ? {
            OSS_REGION: process.env.OSS_REGION,
            OSS_BUCKET: process.env.OSS_BUCKET,
            OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID,
            OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET,
          }
        : {
            MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
            MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
            MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
          };
    return Object.entries(candidates)
      .filter(([, value]) => !value?.trim())
      .map(([key]) => key);
  }

  private sdkHint(name: 'ali-oss' | 'minio'): string {
    return isSdkInstalled(name)
      ? ''
      : `；未安装 SDK ${name}，请先执行 npm --prefix backend install --no-save ${name}`;
  }

  /**
   * 逐个点名缺什么，而不是笼统一句「未启用」：少了 SECRET 和少了 SDK
   * 是两种完全不同的修法，混在一起只会让运维去翻代码。
   *
   * 必须在 active 未就绪的提前 return **之前**跑 —— 那恰恰是最需要诊断的场景
   * （STORAGE_BACKEND 指了一个没配好的云端后端）。只有被选为 active 的后端
   * 才升到 WARN；本地开发时云端未启用是正常状态，打 INFO 就够，不然每次
   * 启动都飘两条警告，真出事时反而没人看。
   */
  private logDisabledBackends(): void {
    for (const backend of ['oss', 'minio'] as const) {
      if (this.providers.has(backend)) continue;
      const sdk = backend === 'oss' ? 'ali-oss' : 'minio';
      const absent = this.requiredEnv(backend);
      const reasons = [
        absent.length > 0 ? `缺环境变量 ${absent.join(', ')}` : '',
        isSdkInstalled(sdk) ? '' : `未安装 SDK ${sdk}（npm --prefix backend install --no-save ${sdk}）`,
      ].filter(Boolean);
      const line = `后端 ${backend} 未启用：${reasons.length > 0 ? reasons.join('；') : '初始化失败，见上方 error 日志'}`;
      if (this.active === backend) this.logger.warn(line);
      else this.logger.log(line);
    }
  }

  async onModuleInit(): Promise<void> {
    this.logDisabledBackends();

    /*
     * 配置的后端没起来 (例如 STORAGE_BACKEND=oss 但 ali-oss 未安装) 时**不回落本地**:
     * 那会让生产数据静默写进容器本地盘, 重启即丢, 而日志只有一行 WARN。
     * 这里保留启动 (健康检查与后台要能报出原因), 但每次读写都走 getActive() 的硬失败。
     */
    if (!this.providers.has(this.active)) {
      this.logger.error(
        `存储后端 ${this.active} 未就绪（SDK 未安装或凭据缺失），上传/读取将直接失败而不是写入本地盘`,
      );
      return;
    }
    const active = this.getActive();
    const probe = await active.probe();
    if (probe.ok) {
      this.logger.log(
        `存储后端 ${this.active} 就绪: ${probe.message}${probe.latencyMs ? ` (${probe.latencyMs}ms)` : ''}`,
      );
    } else {
      this.logger.warn(`存储后端 ${this.active} 不可用: ${probe.message}`);
    }
  }

  private register(p: StorageProvider): void {
    this.providers.set(p.backend, p);
  }

  /** 上传根目录: 配置层优先, 未配置时回落 process.env.UPLOAD_DIR, 最后 'uploads' */
  private resolveUploadsDir(): string {
    const raw = this.config.get<string>('path.uploads') ?? process.env.UPLOAD_DIR ?? 'uploads';
    return resolve(process.cwd(), raw);
  }

  /**
   * 当前默认后端的 provider。
   *
   * 配置的后端不可用时**显式抛错**, 不再静默回落 local —— 回落会把
   * 「配置写错」变成「文件悄悄写进容器本地盘」, 且没有任何调用方知道。
   * 本地后端的回落只保留在 active 本来就是 local 的情况。
   */
  getActive(): StorageProvider {
    const provider = this.providers.get(this.active);
    if (provider) return provider;
    if (this.active === 'local') return this.providers.get('local')!;
    throw new Error(
      `存储后端 ${this.active} 未就绪: SDK 未安装或凭据缺失。` +
        `请补齐依赖/环境变量, 或将 STORAGE_BACKEND 改回 local（已拒绝静默回落本地盘）`,
    );
  }

  get activeBackend(): StorageBackend {
    return this.active;
  }

  /**
   * 按后端取provider。
   *
   * 素材记录里存了 storageBackend, 读取时必须用**当时写入的那个后端**,
   * 否则切换默认后端后老素材全部读不到。
   */
  get(backend: StorageBackend): StorageProvider | null {
    return this.providers.get(backend) ?? null;
  }

  /**
   * 各后端状态, 供后台 B-62/B-63 展示。
   *
   * 返回**全部候选后端**而非仅已注册的: 未配置的 OSS/MinIO 也要出现在
   * 列表里 (configured=false), 否则运营在界面上看不到它们存在,
   * 也就无从得知「补哪些环境变量就能启用」。缺失信息比多余信息更致命。
   */
  async status(): Promise<BackendStatus[]> {
    const out: BackendStatus[] = [];
    for (const backend of STORAGE_BACKENDS) {
      const p = this.providers.get(backend);
      if (!p) {
        out.push({
          backend,
          available: false,
          configured: false,
          active: backend === this.active,
        });
        continue;
      }
      const probe = await p.probe();
      const cred = p.credentialStatus();
      out.push({
        backend,
        available: probe.ok,
        configured: cred.configured,
        active: backend === this.active,
        masked: cred.masked,
        endpoint: cred.endpoint,
        probeMessage: probe.message,
        probeLatencyMs: probe.latencyMs,
      });
    }
    return out;
  }

  /** 切换默认后端 (运行时; 不影响已写入素材的读取) */
  setActive(backend: StorageBackend): void {
    if (!this.providers.has(backend)) {
      throw new Error(`后端未启用: ${backend}`);
    }
    this.active = backend;
    this.logger.warn(`默认存储后端已切换为 ${backend} (已写入的素材仍按原后端读取)`);
  }

  /**
   * 生成存储 key。
   *
   * 格式 `<类别>/<yyyymm>/<随机>.<ext>` —— 按月分目录避免单目录文件过多,
   * 随机名避免同名覆盖。
   */
  buildKey(category: string, ext: string): string {
    const d = new Date();
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `${category}/${ym}/${rand}.${ext}`;
  }
}

export { maskSecret };
