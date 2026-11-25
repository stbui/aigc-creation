import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfigValues } from '../config/env.validation';
import { createHash } from 'node:crypto';
import { resolve } from 'path';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipher } from '../model/infra/secret-cipher';
import { STORAGE_BACKENDS, type StorageBackend, type StorageProvider } from './storage.contract';
import { LocalStorageProvider } from './local-storage.provider';
import { MinioStorageProvider } from './minio-storage.provider';
import { OssStorageProvider } from './oss-storage.provider';
import { isSdkInstalled, maskSecret } from './storage.utils';

/** 可编辑的配置字段定义（与支付渠道 PaymentConfigField 同构，驱动后台表单）。 */
export interface StorageConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'switch' | 'select' | 'number';
  required: boolean;
  secret?: boolean;
  default?: string;
  placeholder?: string;
  /** 字段用途说明，展示在表单提示里 */
  hint?: string;
  /** select 的候选值 */
  options?: Array<{ value: string; label: string }>;
  /** 字段所属分组，用于抽屉内分区展示 */
  group?: string;
  /** number 字段的合法区间 */
  min?: number;
  max?: number;
}

/** 保存配置时前端提交的明文值（密码可留空 = 沿用旧值）。 */
export type StorageConfigValues = Record<string, string>;

/** 单个后端在 status 中下发的编辑视图：非密钥明文 + 密钥是否已配置/脱敏。 */
export interface StorageConfigView {
  fields: StorageConfigField[];
  /** 非密钥字段的当前值（明文，不含任何 secret） */
  values: Record<string, string>;
  /** 密钥字段是否已配置（true = 库里有值，界面可留空沿用） */
  secretConfigured: Record<string, boolean>;
  /** 密钥脱敏值，仅展示，不回传 */
  secretMasked: Record<string, string>;
  /** 配置来源：db = 页面保存过 */
  source: 'db' | 'none';
  /** 保存过配置的后台用户 / 时间，供审计展示 */
  updatedBy?: string;
  updatedAt?: string;
}

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
  /** 该后端的编辑视图（含 local 的公开域名配置） */
  config: StorageConfigView;
}

/**
 * 各后端的可编辑字段定义 —— 与各 provider 的构造参数逐项对齐。
 * secret 字段永不回传明文，界面留空表示沿用旧值。
 *
 * 分组（group）只影响抽屉内的排版顺序：连接位置 → 读取出口 → 凭据 → 高级。
 * 新增字段只需改这里，前端按 fields 渲染，不写死字段名。
 */
export const STORAGE_CONFIG_FIELDS: Record<StorageBackend, StorageConfigField[]> = {
  local: [
    {
      name: 'publicBaseUrl',
      label: '服务器访问地址',
      type: 'text',
      required: false,
      placeholder: 'https://canvas.example.com',
      hint: '用于生成本地素材的访问链接。填写站点根地址，不要附带 /api、查询参数或片段。留空则返回 /uploads 相对路径（走前端同源代理）。',
      group: '读取出口',
    },
  ],
  oss: [
    {
      name: 'region',
      label: 'Region',
      type: 'text',
      required: true,
      placeholder: 'oss-cn-hangzhou',
      hint: '阿里云 OSS 地域，按控制台显示值填写。',
      group: '连接位置',
    },
    {
      name: 'bucket',
      label: 'Bucket',
      type: 'text',
      required: true,
      placeholder: 'my-bucket',
      hint: '对象写入的桶名；Bucket 决定容器，路径前缀用于隔离本应用的对象目录。',
      group: '连接位置',
    },
    {
      name: 'pathPrefix',
      label: '路径前缀',
      type: 'text',
      required: false,
      default: 'huojue',
      placeholder: 'huojue',
      hint: '对象 key 的前缀，便于同桶多应用隔离。留空 = huojue；保存时自动去除首尾斜杠。',
      group: '连接位置',
    },
    {
      name: 'endpoint',
      label: 'Endpoint',
      type: 'text',
      required: false,
      placeholder: 'https://oss-cn-hangzhou.aliyuncs.com',
      hint: '服务端写入使用的服务根地址；留空由 SDK 按 Region 推导。不能包含 Bucket、路径或查询参数。',
      group: '连接位置',
    },
    {
      name: 'publicBaseUrl',
      label: '公开访问域名',
      type: 'text',
      required: false,
      placeholder: 'https://media.example.com',
      hint: 'CDN 或自定义域名，只影响浏览器读取出口。填写后预览走直读，不生成签名链接。',
      group: '读取出口',
    },
    {
      name: 'urlExpiresSeconds',
      label: '签名有效期（秒）',
      type: 'number',
      required: false,
      default: '3600',
      min: 60,
      max: 604800,
      hint: '私有桶签名链接的有效期，仅用于页面即时预览，不入库。留空回落到 3600。',
      group: '读取出口',
    },
    {
      name: 'accessKeyId',
      label: 'AccessKey ID',
      type: 'text',
      required: true,
      secret: true,
      group: '服务端凭据',
    },
    {
      name: 'accessKeySecret',
      label: 'AccessKey Secret',
      type: 'password',
      required: true,
      secret: true,
      group: '服务端凭据',
    },
    {
      name: 'sessionToken',
      label: 'STS Session Token（可选）',
      type: 'password',
      required: false,
      secret: true,
      hint: '使用 STS 临时凭证时填写；留空并切换厂商时不会沿用另一厂商的 Token。',
      group: '服务端凭据',
    },
    {
      name: 'autoCreateBucket',
      label: '桶不存在时自动创建',
      type: 'switch',
      required: false,
      default: 'false',
      hint: '仅建议对自建存储开启；公有云通常由平台侧预建桶并授予最小权限。',
      group: '高级',
    },
  ],
  minio: [
    {
      name: 'endPoint',
      label: '服务地址',
      type: 'text',
      required: true,
      placeholder: '127.0.0.1',
      hint: 'MinIO 或 S3 兼容服务的主机名，不含协议与端口。',
      group: '连接位置',
    },
    {
      name: 'port',
      label: '端口',
      type: 'number',
      required: false,
      default: '9000',
      min: 1,
      max: 65535,
      group: '连接位置',
    },
    {
      name: 'useSSL',
      label: '使用 HTTPS',
      type: 'switch',
      required: false,
      default: 'false',
      hint: '开启后服务端与浏览器都走 TLS；自签证书需让后端信任该 CA。',
      group: '连接位置',
    },
    {
      name: 'region',
      label: 'Region',
      type: 'text',
      required: false,
      default: 'us-east-1',
      placeholder: 'us-east-1',
      hint: '自建 MinIO 默认 us-east-1；云厂商兼容服务按控制台填写。',
      group: '连接位置',
    },
    {
      name: 'bucket',
      label: 'Bucket',
      type: 'text',
      required: false,
      default: 'huojue',
      hint: '对象写入的桶名；留空回落到 huojue。',
      group: '连接位置',
    },
    {
      name: 'pathPrefix',
      label: '路径前缀',
      type: 'text',
      required: false,
      default: 'huojue',
      placeholder: 'huojue',
      hint: '对象 key 的前缀，便于同桶多应用隔离。留空 = huojue。',
      group: '连接位置',
    },
    {
      name: 'publicBaseUrl',
      label: '公开访问域名',
      type: 'text',
      required: false,
      placeholder: 'https://media.example.com',
      hint: 'CDN 或自定义域名，只影响浏览器读取出口。填写后预览走直读，不生成预签名链接。',
      group: '读取出口',
    },
    {
      name: 'urlExpiresSeconds',
      label: '预签名有效期（秒）',
      type: 'number',
      required: false,
      min: 60,
      max: 604800,
      hint: '私有桶预签名链接的有效期，仅用于页面即时预览，不入库。留空使用 SDK 默认（7 天）。',
      group: '读取出口',
    },
    {
      name: 'accessKey',
      label: 'Access Key',
      type: 'text',
      required: true,
      secret: true,
      group: '服务端凭据',
    },
    {
      name: 'secretKey',
      label: 'Secret Key',
      type: 'password',
      required: true,
      secret: true,
      group: '服务端凭据',
    },
    {
      name: 'autoCreateBucket',
      label: '桶不存在时自动创建',
      type: 'switch',
      required: false,
      default: 'false',
      hint: '自建 MinIO 可开启；公有云兼容服务请预建桶并授予最小权限。',
      group: '高级',
    },
  ],
};

/** 字段分组展示顺序；未标注 group 的字段归入「其他」。 */
export const STORAGE_FIELD_GROUPS = ['连接位置', '读取出口', '服务端凭据', '高级', '其他'] as const;

/** 对象 key 前缀的默认值（与字段 default 对齐，供 buildKey 使用）。 */
export const DEFAULT_STORAGE_PATH_PREFIX = 'huojue';

/** 去掉首尾斜杠并压缩重复斜杠；空值回落到默认前缀。 */
export function normalizePathPrefix(raw: string | undefined): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return cleaned || DEFAULT_STORAGE_PATH_PREFIX;
}

/**
 * 服务根地址校验：必须 http/https、带主机、不含认证信息 / 路径 / 查询 / 片段。
 *
 * 写错的 Endpoint（例如把 Bucket 域名或控制台地址贴进来）会让 SDK 在运行时
 * 报出难以定位的 404 —— 保存时就该拦下。
 */
export function validateServiceEndpoint(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Endpoint 必须是完整的 http/https 地址';
  }
  if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return 'Endpoint 必须是完整的 http/https 地址';
  }
  if (parsed.username || parsed.password) return 'Endpoint 不能包含认证信息';
  if (parsed.search || parsed.hash) return 'Endpoint 不能包含查询参数或片段';
  if (parsed.pathname.replace(/\/+$/g, '') !== '') {
    return 'Endpoint 必须是服务根地址，不能包含 Bucket 或对象路径';
  }
  return '';
}

/** 公开域名校验：同 Endpoint，另外不允许带路径（CDN 应该只给根域名）。 */
export function validatePublicBaseUrl(raw: string): string {
  const base = validateServiceEndpoint(raw);
  if (base) return base.replace('Endpoint', '公开访问域名');
  return '';
}

/** 判定 useSSL 字符串是否为真（与 env.validation 的 boolean 解析口径一致）。 */
function truthy(v: string | undefined): boolean {
  return String(v ?? '').trim().toLowerCase() === 'true';
}

/** 解析正整数；空串 / 非数字 / 越界返回 undefined（由调用方回落到默认值）。 */
function positiveInt(v: string | undefined): number | undefined {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * 存储工厂 + 可编辑配置中心。
 *
 * 配置来源（2026-11 改为仅 DB 页面配置，见 docs/non-upstream-extensions.md）：
 *   DB StorageConfig (页面保存, 凭据加密) > 缺省 local
 *
 * 行为约束（重构前后必须一致的部分）：
 *   - getActive / get / buildKey / setActive 的签名与语义不变，所有业务调用方无感；
 *   - 配置的后端不可用时显式抛错，不静默回落本地盘；
 *   - 云端 SDK 按需 require，未启用后端时不加载。
 *   - 保存配置后即时重建 provider（rebuild），无需重启进程。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private providers = new Map<StorageBackend, StorageProvider>();
  private active: StorageBackend = 'local';
  /** 已解析的明文配置值（密钥为明文，仅内存，绝不外泄） */
  private values = new Map<StorageBackend, StorageConfigValues>();
  /** 配置来源：页面保存过则为 db，否则为 none。 */
  private sources = new Map<StorageBackend, 'db' | 'none'>();
  /** 配置审计信息（最后修改人 / 时间），来自 StorageConfig 行。 */
  private audit = new Map<StorageBackend, { updatedBy: string | null; updatedAt: Date | null }>();
  /** 数据库中标记的默认后端；没有标记时固定使用 local。 */
  private storedActive: StorageBackend | null = null;
  /** 本地后端根目录（UPLOAD_DIR 解析结果） */
  private localRoot = '';

  constructor(
    private readonly config: ConfigService<AppConfigValues, true>,
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
  ) {
    /*
     * 不能把 process.env 直接 as 成 StorageBackend: 拼错一个字母就会得到一个
     * map 里根本不存在的 active，启动时一切正常、第一次上传才炸。这里显式
     * 收窄（与 env.validation.ts 的 oneOf 同一份白名单），非法值当场报错。
     */
    // 本地后端始终可用，根目录取自 UPLOAD_DIR。
    this.localRoot = this.resolveUploadsDir();
    this.register(this.buildLocal());
  }

  /** 启动时把三个后端都从 DB 加载；没有数据库记录时保持 local 的默认行为。 */
  async onModuleInit(): Promise<void> {
    for (const backend of STORAGE_BACKENDS) {
      await this.loadBackend(backend);
    }
    this.active = this.storedActive ?? 'local';
    this.logDisabledBackends();

    if (!this.providers.has(this.active)) {
      this.logger.error(
        `存储后端 ${this.active} 未就绪（SDK 未安装或配置缺失），上传/读取将直接失败而不是写入本地盘`,
      );
      return;
    }
    const probe = await this.getActive().probe();
    if (probe.ok) {
      this.logger.log(
        `存储后端 ${this.active} 就绪: ${probe.message}${probe.latencyMs ? ` (${probe.latencyMs}ms)` : ''}`,
      );
    } else {
      this.logger.warn(`存储后端 ${this.active} 不可用: ${probe.message}`);
    }
  }

  /** 读取单个后端的有效配置：唯一来源是 DB。 */
  private async loadBackend(backend: StorageBackend): Promise<void> {
    let values: StorageConfigValues | null = null;
    let source: 'db' | 'none' = 'none';
    try {
      const row = await this.prisma.storageConfig.findUnique({ where: { backend } });
      if (row?.active && !this.storedActive) this.storedActive = backend;
      if (row) {
        this.audit.set(backend, {
          updatedBy: row.updatedBy ?? null,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
        });
      }
      if (row?.configCipher) {
        values = this.parseValues(this.cipher.decrypt(row.configCipher), backend);
        source = 'db';
      }
    } catch (e) {
      this.logger.error(`读取存储配置 ${backend} 失败: ${(e as Error).message}`);
    }
    this.applyValues(backend, values, source);
  }

  /** 必填字段是否齐全（非空）。 */
  private complete(values: StorageConfigValues, backend: StorageBackend): boolean {
    return STORAGE_CONFIG_FIELDS[backend]
      .filter((f) => f.required)
      .every((f) => Boolean(String(values[f.name] ?? '').trim()));
  }

  private parseValues(raw: string, backend: StorageBackend): StorageConfigValues | null {
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      return this.normalizeValues(obj as Record<string, unknown>, backend);
    } catch {
      this.logger.error('存储配置 JSON 解析失败，已忽略该行');
      return null;
    }
  }

  /** 只保留当前后端的白名单字段，并把旧库里的标量值归一成字符串。 */
  private normalizeValues(
    input: Record<string, unknown>,
    backend: StorageBackend,
  ): StorageConfigValues {
    const values: StorageConfigValues = {};
    for (const field of STORAGE_CONFIG_FIELDS[backend]) {
      if (Object.prototype.hasOwnProperty.call(input, field.name)) {
        values[field.name] = String(input[field.name] ?? '');
      }
    }
    return values;
  }

  /**
   * 把一份配置应用到内存：保存明文值，凭据齐全则重建并注册 provider。
   * values 为 null 表示清空配置 —— 移除 provider。
   */
  private applyValues(
    backend: StorageBackend,
    values: StorageConfigValues | null,
    source: 'db' | 'none',
  ): void {
    if (!values) {
      this.values.delete(backend);
      this.sources.set(backend, 'none');
      this.providers.delete(backend);
      if (backend === 'local') this.register(this.buildLocal());
      return;
    }
    if (!this.complete(values, backend)) {
      /*
       * 云端后端凭据不全时视为未启用：不注册 provider（getActive 会显式报错）。
       * 本地后端没有必填项，只有在配置解析失败时才会走到这里；此时仍要保留
       * 公开域名，否则一次读取异常就把页面配置的访问地址丢了。
       */
      this.values.delete(backend);
      this.sources.set(backend, values ? source : 'none');
      this.providers.delete(backend);
      if (backend === 'local') {
        this.values.set(backend, values);
        this.sources.set(backend, source);
        this.register(this.buildLocal(values));
      }
      return;
    }
    this.values.set(backend, values);
    this.sources.set(backend, source);
    try {
      this.providers.set(backend, this.buildProvider(backend, values));
    } catch (e) {
      this.providers.delete(backend);
      if (backend === 'local') this.register(this.buildLocal());
      this.logger.error(
        `存储后端 ${backend} 初始化失败(将被忽略): ${(e as Error).message}${this.sdkHint(backend)}`,
      );
    }
  }

  /** 本地 provider 始终可用，公开域名来自页面配置（可缺省）。 */
  private buildLocal(values: StorageConfigValues = {}): StorageProvider {
    const publicBaseUrl = values.publicBaseUrl ?? this.values.get('local')?.publicBaseUrl;
    return new LocalStorageProvider(this.localRoot, '/uploads', publicBaseUrl || undefined);
  }

  /** 依据明文配置构造 provider（不读 env）。 */
  private buildProvider(backend: StorageBackend, v: StorageConfigValues): StorageProvider {
    if (backend === 'local') return this.buildLocal(v);
    if (backend === 'oss') {
      return new OssStorageProvider({
        region: v.region,
        bucket: v.bucket,
        accessKeyId: v.accessKeyId,
        accessKeySecret: v.accessKeySecret,
        ...(v.endpoint ? { endpoint: v.endpoint } : {}),
        ...(v.sessionToken ? { sessionToken: v.sessionToken } : {}),
        ...(v.publicBaseUrl ? { publicBaseUrl: v.publicBaseUrl } : {}),
        ...(positiveInt(v.urlExpiresSeconds) ? { urlExpiresSeconds: positiveInt(v.urlExpiresSeconds) } : {}),
      });
    }
    return new MinioStorageProvider({
      endPoint: v.endPoint,
      port: positiveInt(v.port) ?? 9000,
      useSSL: truthy(v.useSSL),
      accessKey: v.accessKey,
      secretKey: v.secretKey,
      bucket: v.bucket || 'huojue',
      ...(v.region ? { region: v.region } : {}),
      ...(v.publicBaseUrl ? { publicBaseUrl: v.publicBaseUrl } : {}),
      ...(positiveInt(v.urlExpiresSeconds) ? { urlExpiresSeconds: positiveInt(v.urlExpiresSeconds) } : {}),
      autoCreateBucket: truthy(v.autoCreateBucket),
    });
  }

  /**
   * 保存页面提交的配置（凭据加密落库）并即时生效。
   *
   * secret 字段留空 = 沿用当前值（避免明文回传后又被覆盖成空）。
   * 返回脱敏后的配置视图，前端据此刷新，不接触任何明文密钥。
   */
  async saveConfig(
    backend: StorageBackend,
    submitted: StorageConfigValues,
    actor?: string,
  ): Promise<StorageConfigView> {
    const merged = this.mergeValues(backend, submitted);
    const plain = JSON.stringify(merged);
    const digest = createHash('sha256').update(plain).digest('hex');
    const cipherText = this.cipher.encrypt(plain);
    const saved = await this.prisma.storageConfig.upsert({
      where: { backend },
      create: { backend, configCipher: cipherText, configDigest: digest, updatedBy: actor ?? null, active: false },
      update: { configCipher: cipherText, configDigest: digest, updatedBy: actor ?? null },
    });

    this.applyValues(backend, merged, 'db');
    this.audit.set(backend, { updatedBy: actor ?? null, updatedAt: saved?.updatedAt instanceof Date ? saved.updatedAt : new Date() });
    this.logger.log(`存储后端 ${backend} 配置已更新并即时生效 (操作人: ${actor ?? '未知'})`);
    return this.configView(backend);
  }

  /**
   * 用页面草稿做一次真实读写测试，不落库、不切换默认后端。
   *
   * 先测后存是参考实现的核心交互：配置写错时应该停在抽屉里看到原因，
   * 而不是先保存（可能把运行时打挂）再回滚。
   */
  async testDraft(
    backend: StorageBackend,
    submitted: StorageConfigValues,
  ): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    // 配置不完整属于用户输入问题，保持 400 抛出；SDK 缺失 / 构造失败属于
    // 环境问题，应当以 ok=false 的诊断结果回到抽屉，而不是整页 500。
    const merged = this.mergeValues(backend, submitted);
    let provider: StorageProvider;
    try {
      provider = this.buildProvider(backend, merged);
    } catch (e) {
      return {
        ok: false,
        message: `无法初始化 ${backend} 客户端: ${(e as Error).message}${this.sdkHint(backend)}`,
      };
    }
    return provider.probe({ verifyWrite: true });
  }

  /** 合并旧值 + 本次提交，secret 留空沿用；随后做必填与字段级校验。 */
  private mergeValues(backend: StorageBackend, submitted: StorageConfigValues): StorageConfigValues {
    const prev = this.values.get(backend) ?? {};
    const merged: StorageConfigValues = { ...prev };
    for (const field of STORAGE_CONFIG_FIELDS[backend]) {
      const incoming = String(submitted[field.name] ?? '').trim();
      if (field.secret) {
        merged[field.name] = incoming ? incoming : (prev[field.name] ?? (field.default ?? ''));
      } else {
        merged[field.name] = incoming || (field.default ?? '');
      }
    }
    // pathPrefix 单独归一：首尾斜杠与重复斜杠都会破坏 key 隔离
    merged.pathPrefix = normalizePathPrefix(merged.pathPrefix);
    if (!this.complete(merged, backend)) {
      throw new AppError(40001, `存储后端 ${backend} 的必填配置不完整`, 400);
    }
    const invalid = this.validateValues(backend, merged);
    if (invalid) throw new AppError(40001, invalid, 400);
    return merged;
  }

  /** 字段级校验：返回第一条错误文案，空串表示通过。 */
  private validateValues(backend: StorageBackend, values: StorageConfigValues): string {
    const endpointError = validateServiceEndpoint(values.endpoint ?? '');
    if (endpointError) return endpointError;
    const publicError = validatePublicBaseUrl(values.publicBaseUrl ?? '');
    if (publicError) return publicError;
    if (backend === 'minio') {
      const port = Number(values.port);
      if (values.port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        return `端口必须是 1-65535 的整数（当前 ${values.port}）`;
      }
      if (/^[a-z]+:\/\//i.test(values.endPoint ?? '')) {
        return '服务地址只填主机名，不要带 http:// 或 https://（协议由「使用 HTTPS」控制）';
      }
    }
    const expires = values.urlExpiresSeconds;
    if (expires) {
      const field = STORAGE_CONFIG_FIELDS[backend].find((f) => f.name === 'urlExpiresSeconds');
      const n = Number(expires);
      if (!Number.isInteger(n) || (field?.min && n < field.min) || (field?.max && n > field.max)) {
        return `签名有效期必须是 ${field?.min ?? 60}-${field?.max ?? 604800} 之间的整数秒`;
      }
    }
    return '';
  }

  private sdkHint(backend: StorageBackend): string {
    const name = backend === 'oss' ? 'ali-oss' : backend === 'minio' ? 'minio' : null;
    if (!name || isSdkInstalled(name)) return '';
    return `；未安装 SDK ${name}，请先执行 npm --prefix backend install --no-save ${name}`;
  }

  /** 逐个点名云端后端未启用的原因；active 后端的缺失升到 WARN。 */
  private logDisabledBackends(): void {
    for (const backend of ['oss', 'minio'] as const) {
      if (this.providers.has(backend)) continue;
      const sdk = backend === 'oss' ? 'ali-oss' : 'minio';
      const values = this.values.get(backend);
      const absent = values
        ? STORAGE_CONFIG_FIELDS[backend]
            .filter((f) => f.required && !String(values[f.name] ?? '').trim())
            .map((f) => f.name)
        : ['配置'];
      const reasons = [
        absent.length > 0 ? `缺配置 ${absent.join(', ')}（后台存储配置页）` : '',
        isSdkInstalled(sdk) ? '' : `未安装 SDK ${sdk}（npm --prefix backend install --no-save ${sdk}）`,
      ].filter(Boolean);
      const line = `后端 ${backend} 未启用：${reasons.length > 0 ? reasons.join('；') : '初始化失败，见上方 error 日志'}`;
      if (this.active === backend) this.logger.warn(line);
      else this.logger.log(line);
    }
  }

  private register(p: StorageProvider): void {
    this.providers.set(p.backend, p);
  }

  private resolveUploadsDir(): string {
    const raw = this.config.get<string>('path.uploads') ?? 'uploads';
    return resolve(process.cwd(), raw);
  }

  /** 当前默认后端的 provider；配置的后端不可用时显式抛错，不静默回落 local。 */
  getActive(): StorageProvider {
    const provider = this.providers.get(this.active);
    if (provider) return provider;
    if (this.active === 'local') return this.providers.get('local')!;
    throw new Error(
      `存储后端 ${this.active} 未就绪: SDK 未安装或配置缺失。` +
        `请在后台「存储配置」页补齐配置并设为默认后端（已拒绝静默回落本地盘）`,
    );
  }

  get activeBackend(): StorageBackend {
    return this.active;
  }

  /** 读取时必须用素材写入时的后端，否则切换默认后老素材读不到。 */
  get(backend: StorageBackend): StorageProvider | null {
    return this.providers.get(backend) ?? null;
  }

  /** 某个后端的编辑视图；secret 只回「是否配置 + 脱敏」，绝不回明文。 */
  configView(backend: StorageBackend): StorageConfigView {
    const fields = STORAGE_CONFIG_FIELDS[backend];
    const values = this.values.get(backend);
    const audit = this.audit.get(backend);
    const auditView = audit
      ? {
          updatedBy: audit.updatedBy ?? undefined,
          ...(audit.updatedAt ? { updatedAt: audit.updatedAt.toISOString() } : {}),
        }
      : {};
    if (!values) {
      return {
        fields,
        values: Object.fromEntries(fields.filter((f) => !f.secret).map((f) => [f.name, f.default ?? ''])),
        secretConfigured: Object.fromEntries(fields.filter((f) => f.secret).map((f) => [f.name, false])),
        secretMasked: {},
        source: 'none',
        ...auditView,
      };
    }
    const secretConfigured: Record<string, boolean> = {};
    const secretMasked: Record<string, string> = {};
    const publicValues: Record<string, string> = {};
    for (const f of fields) {
      if (f.secret) {
        const plain = values[f.name] ?? '';
        secretConfigured[f.name] = Boolean(plain);
        const masked = maskSecret(plain);
        if (masked) secretMasked[f.name] = masked;
      } else {
        publicValues[f.name] = values[f.name] ?? f.default ?? '';
      }
    }
    return {
      fields,
      values: publicValues,
      secretConfigured,
      secretMasked,
      source: this.sources.get(backend) ?? 'none',
      ...auditView,
    };
  }

  /** 各后端状态，供后台 B-62/B-63 展示。 */
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
          config: this.configView(backend),
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
        config: this.configView(backend),
      });
    }
    return out;
  }

  /** 切换默认后端 (运行时; 不影响已写入素材的读取)。 */
  async setActive(backend: StorageBackend): Promise<void> {
    if (!this.providers.has(backend)) {
      throw new Error(`后端未启用: ${backend}`);
    }
    await this.prisma.$transaction(async (tx) => {
      // 先清空所有 active 标记，再给目标后端置位。目标后端若还没有配置行
      // （例如只切 local），update 会找不到行 —— 用 updateMany 兜底，避免
      // 「切回本地」因为一行都没有而抛异常。
      await tx.storageConfig.updateMany({ data: { active: false } });
      if (backend !== 'local') {
        await tx.storageConfig.updateMany({ where: { backend }, data: { active: true } });
      }
    });
    this.active = backend;
    this.logger.warn(`默认存储后端已切换为 ${backend} 并保存到数据库 (已写入的素材仍按原后端读取)`);
  }

  buildKey(category: string, ext: string): string {
    const d = new Date();
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    /*
     * 路径前缀只作用于云端后端的新写入 key：
     *   - 本地盘的目录结构是部署契约（/uploads/<key>），加前缀会改变静态路由；
     *   - 历史素材的 key 原样留在库里，靠存储的完整 key 读取，改前缀不会让老图 404。
     */
    const prefix =
      this.active === 'local' ? '' : `${normalizePathPrefix(this.values.get(this.active)?.pathPrefix)}/`;
    return `${prefix}${category}/${ym}/${rand}.${ext}`;
  }
}

export { maskSecret };
