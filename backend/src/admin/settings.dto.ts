import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 系统设置项定义。
 *
 * 用代码声明而非裸 kv: 每项有类型、默认值、取值范围与说明,
 * 避免后台存进库里的值无法校验 (存了 "abc" 到 number 类型的项,
 * 后续读取时静默出错比拒绝写入更糟)。
 *
 * ⚠️ 这里的默认值是**代码默认值**, 可被 SystemSetting 表覆盖 (运行时覆盖)。
 * 与 capability.registry / GATEWAY_* 环境变量是同一优先级链。
 */
export interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  default: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  /** 分组, 前端按此渲染 Tab */
  group: SettingGroup;
  /** 环境徽标类配置是否只读 (凭据类不由后台编辑) */
  readOnly?: boolean;
}

export type SettingGroup = 'site' | 'upload' | 'generate' | 'security';

export const SETTING_DEFS: SettingDef[] = [
  // ── 站点 ────────────────────────────────────────────────────────────
  {
    key: 'site.name',
    label: '站点名称',
    description: '显示在页面标题与页脚',
    type: 'string',
    default: '货觉AI',
    maxLength: 40,
    group: 'site',
  },
  {
    key: 'site.maintenance',
    label: '维护模式',
    description: '开启后 C 端只读, 生成接口返回 503。用户仍可查看订单与申请退款',
    type: 'boolean',
    default: false,
    group: 'site',
  },

  // ── 上传 ────────────────────────────────────────────────────────────
  {
    key: 'upload.maxSizeMb',
    label: '单文件大小上限',
    description: '前端与后端同步校验, 以后端为准',
    type: 'number',
    default: 20,
    min: 1,
    max: 200,
    group: 'upload',
  },
  {
    key: 'upload.allowedTypes',
    label: '允许的文件类型',
    description: '逗号分隔的扩展名, 如 jpg,png,webp',
    type: 'string',
    default: 'jpg,jpeg,png,webp',
    maxLength: 200,
    group: 'upload',
  },

  // ── 生成 ────────────────────────────────────────────────────────────
  {
    key: 'generate.maxConcurrent',
    label: '并发任务上限',
    description: '单用户同时进行的生成任务数',
    type: 'number',
    default: 3,
    min: 1,
    max: 20,
    group: 'generate',
  },
  {
    key: 'generate.pollIntervalMs',
    label: '轮询间隔',
    description: '前端查询任务状态的间隔',
    type: 'number',
    default: 1200,
    min: 500,
    max: 10000,
    group: 'generate',
  },
  {
    key: 'generate.maxPolls',
    label: '最大轮询次数',
    description: '超出视为超时。对应 GATEWAY_MAX_POLLS',
    type: 'number',
    default: 60,
    min: 5,
    max: 300,
    group: 'generate',
  },

  // ── 数据安全 ────────────────────────────────────────────────────────
  {
    key: 'backup.frequencyDays',
    label: '备份频次',
    description: '每隔多少天自动备份一次。可选 1 / 7 / 30',
    type: 'number',
    default: 1,
    min: 1,
    max: 30,
    group: 'security',
  },
  {
    key: 'backup.keepCount',
    label: '备份保留份数',
    description: '超过此份数的旧备份会被自动清理。至少保留 1 份',
    type: 'number',
    default: 7,
    min: 1,
    max: 100,
    group: 'security',
  },
  {
    key: 'retention.auditLogDays',
    label: '操作日志保留天数',
    description:
      '超过此天数的操作日志会被清理。订单与用户素材不参与清理（《电子商务法》要求交易信息保存 3 年）',
    type: 'number',
    default: 180,
    min: 30,
    max: 1095,
    group: 'security',
  },

  // ── 安全 ────────────────────────────────────────────────────────────
  {
    key: 'security.sessionTtlDays',
    label: '会话有效期',
    description: 'JWT 有效期。天数越长风险越高, 生产建议改短并配合 refresh',
    type: 'number',
    default: 7,
    min: 1,
    max: 30,
    group: 'security',
  },
  {
    key: 'security.passwordMinLength',
    label: '密码最小长度',
    description: '仅对新设置的密码生效',
    type: 'number',
    default: 8,
    min: 6,
    max: 32,
    group: 'security',
  },
];

export const SETTING_KEYS = SETTING_DEFS.map((d) => d.key);

export function findSettingDef(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((d) => d.key === key);
}

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  site: '站点',
  upload: '上传',
  generate: '生成',
  security: '安全',
};

/**
 * 写入系统设置 (扁平结构)。
 *
 * ⚠️ 每个字段都必须显式声明校验装饰器 —— 全局 ValidationPipe 配了
 * `whitelist: true`, 未声明的属性会被**静默剥离**。曾用
 * `settings!: Record<string, unknown>` 导致: 请求 200 但什么都没写入,
 * 表现为"保存成功但配置没变"。这类静默失败比直接报错更难排查。
 *
 * 键名与服务端 SETTING_DEFS 的 key 不同 (这里是 siteName 而非 site.name),
 * 原因: class-validator 的属性名不能带点号, 用 FIELD_TO_SETTING_KEY 做映射。
 *
 * 范围校验在此层与 service 层双重进行 —— 这里的 min/max 是给前端即时反馈,
 * service 里按 SettingDef 再校验一次, 保证绕过前端直接调接口时也拦得住。
 */
export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(40) siteName?: string;
  @IsOptional() @IsBoolean() siteMaintenance?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(200) uploadMaxSizeMb?: number;
  @IsOptional() @IsString() @MaxLength(200) uploadAllowedTypes?: string;

  @IsOptional() @IsInt() @Min(1) @Max(20) generateMaxConcurrent?: number;
  @IsOptional() @IsInt() @Min(500) @Max(10000) generatePollIntervalMs?: number;
  @IsOptional() @IsInt() @Min(5) @Max(300) generateMaxPolls?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30) backupFrequencyDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) backupKeepCount?: number;
  @IsOptional() @IsInt() @Min(30) @Max(1095) retentionAuditLogDays?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30) securitySessionTtlDays?: number;
  @IsOptional() @IsInt() @Min(6) @Max(32) securityPasswordMinLength?: number;

  /** 操作原因。写入系统设置属高危动作, 建议填写以便追溯 */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** DTO 字段名 → SETTING_DEFS 键 的映射 */
export const FIELD_TO_SETTING_KEY: Record<string, string> = {
  siteName: 'site.name',
  siteMaintenance: 'site.maintenance',
  uploadMaxSizeMb: 'upload.maxSizeMb',
  uploadAllowedTypes: 'upload.allowedTypes',
  generateMaxConcurrent: 'generate.maxConcurrent',
  generatePollIntervalMs: 'generate.pollIntervalMs',
  generateMaxPolls: 'generate.maxPolls',
  backupFrequencyDays: 'backup.frequencyDays',
  backupKeepCount: 'backup.keepCount',
  retentionAuditLogDays: 'retention.auditLogDays',
  securitySessionTtlDays: 'security.sessionTtlDays',
  securityPasswordMinLength: 'security.passwordMinLength',
};

/**
 * 从 DTO 提取「本次真正要改的键值」。
 *
 * 用 hasOwnProperty 而非真值判断 —— siteMaintenance=false、uploadMaxSizeMb=0
 * 都是有效值, 用 `if (dto.siteMaintenance)` 会把 false 误判为"未提供"。
 */
export function collectSettingEntries(dto: UpdateSettingsDto): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = dto as unknown as Record<string, unknown>;
  for (const [field, key] of Object.entries(FIELD_TO_SETTING_KEY)) {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      out[key] = source[field];
    }
  }
  return out;
}
