import { AppError } from './app.exception';

/**
 * 系统设置项定义 —— **全站设置项的唯一事实源**。
 *
 * 放在 `common/` 而不是 `admin/`，是因为运行时要读这些值的地方散落在
 * `assets/` `mobile-upload/` `generate/` 等业务模块 —— 若定义留在 admin 层，
 * 业务模块就得反向依赖后台模块，模块依赖方向就倒置了。
 * 这里只放**纯数据与纯函数**，不碰 Prisma，可被任何模块安全导入。
 *
 * 优先级链 (与模型通道配置同构):
 *   代码默认值 (本文件)  →  DB 运行时覆盖 (SystemSetting 表)
 *
 * ⚠️ 改默认值前先确认运行时的真实兜底值 —— 默认值写在页面上是给运营看的
 * 「基准线」，它与代码里实际的兜底不一致时，页面就在骗人。
 * 本文件里的每个 `default` 都必须与对应运行时常量的兜底值逐字相等。
 */
export interface SettingDef {

  /** 键名。点号分隔，`<分组>.<项>` —— 分组段必须与 `group` 一致 */
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  /** 代码默认值。与运行时常量的兜底值必须一致 */
  default: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  /** 允许取值的枚举。命中时优先于 min/max —— 调度器等消费方按白名单判定 */
  enum?: number[];
  /** 字符串型可选值白名单（如币种 CNY / USD）。命中时按枚举校验 */
  options?: string[];
  /** 分组, 前端按此渲染 Tab */
  group: SettingGroup;
  /** 只读项：真实旋钮在别处，页面上只作「配置地图」并给出跳转 */
  readOnly?: boolean;
  /** 可下发到 C 端公开接口的项 */
  public?: boolean;
  /** 只读项的跳转目标（后台路由），供页面渲染入口 */
  linkTo?: string;
}

/*
 * 分组键必须与 `key.split('.')[0]` 一一对应, 且每个分组有自己的中文名。
 *
 * ⚠ 2026-10-22: 此前 backup / retention 两组都写成 'security', 而
 * SETTING_GROUP_LABELS 又没有这两个键, 结果是系统设置页出现**三个同名「安全」页签**。
 * 运营要改备份策略时得在三个同名片里逐个点开盲找, 也无法向同事描述"在哪个安全页里改"。
 * 新增一组设置时, 这里与 SETTING_GROUP_LABELS 必须同时加。
 */
export type SettingGroup =
  | 'site'
  | 'upload'
  | 'generate'
  | 'refund'
  | 'payment'
  | 'backup'
  | 'retention'
  | 'security';

export const SETTING_DEFS: SettingDef[] = [
  // ── 站点 ────────────────────────────────────────────────────────────
  {
    key: 'site.name',
    label: '站点名称',
    description:
      '显示在页面标题与页脚。改品牌名需同时改扩展语言包、发票抬头与 AIGC 角标声明（合规动作），当前固定在代码里',
    type: 'string',
    default: '货觉AI',
    maxLength: 40,
    group: 'site',
    readOnly: true,
  },
  {
    key: 'site.maintenance',
    label: '维护模式',
    description:
      '开启后 C 端只读，生成接口返回 503。用户仍可查看订单与申请退款。**闸门尚未上线，当前改动不生效**',
    type: 'boolean',
    default: false,
    group: 'site',
    // 闸门（全局 Guard）随下一版本上线。在那之前这里必须只读 ——
    // 一个能拖动却不生效的开关，正是本轮要消灭的那类「配置与行为分叉」。
    readOnly: true,
  },

  // ── 上传 ────────────────────────────────────────────────────────────
  {
    key: 'upload.maxSizeMb',
    label: '单文件大小上限',
    description: '前端提示与后端校验同源，以后端为准',
    type: 'number',
    default: 10,
    min: 1,
    max: 100,
    group: 'upload',
    public: true,
  },
  {
    key: 'upload.maxPixels',
    label: '单图像素上限',
    description: '超过此像素数的图片会被拒绝（解码炸弹防护）。单位：万像素',
    type: 'number',
    default: 4000,
    min: 100,
    max: 20000,
    group: 'upload',
    public: true,
  },
  {
    key: 'upload.allowedTypes',
    label: '允许的文件类型',
    description: '逗号分隔的扩展名，如 jpg,jpeg,png,webp',
    type: 'string',
    default: 'jpg,jpeg,png,webp',
    maxLength: 200,
    group: 'upload',
    public: true,
  },

  // ── 生成 ────────────────────────────────────────────────────────────
  {
    key: 'generate.maxConcurrent',
    label: '并发任务上限',
    description:
      '非会员用户的并发上限。会员按套餐权益计（会员套餐页配置）。0 = 不限',
    type: 'number',
    default: 0,
    min: 0,
    max: 20,
    group: 'generate',
    readOnly: true,
    linkTo: '/admin/membership-plans',
  },
  /*
   * 旧的 `generate.pollIntervalMs` / `generate.maxPolls` 随 P6 删除：
   * 轮询节奏由协议运行时决定（渠道模型上的 pollIntervalMs / maxPolls），
   * 不再有「按模态在后台调一个全局值」这层配置。C 端查询任务的间隔是
   * 前端常量 `POLL_INTERVAL_MS`。
   */
  {
    key: 'generate.billingAutoRefund',
    label: '冻结积分自动退回',
    description:
      '开启后，每分钟把「待核对」队列里确定没有交付的冻结积分自动退回：结果不明、运行超过 40 分钟、任务已失败/取消但仍预留。' +
      '已出作品或正在补交付的订单会被排除。默认关闭 —— 待核对订单可能已在上游产生费用，是否自动退是运营口径，不是技术默认',
    type: 'boolean',
    default: false,
    group: 'generate',
  },

  // ── 支付 ────────────────────────────────────────────────────────────
  {
    key: 'payment.defaultCurrency',
    label: '默认币种',
    description:
      '决定新建充值商品的默认币种与 C 端充值面板的默认标签页。不会改写历史商品价格',
    type: 'string',
    options: ['CNY', 'USD'],
    default: 'CNY',
    group: 'payment',
    public: true,
  },

  // ── 退款 ────────────────────────────────────────────────────────────
  {
    key: 'refund.windowDays',
    label: '可退款时间窗',
    description:
      '支付成功后多少天内可以退款。0 = 不限时间（仍受可退金额与积分消耗规则约束）',
    type: 'number',
    default: 7,
    min: 0,
    max: 365,
    group: 'refund',
  },
  {
    key: 'refund.maxRatioBps',
    label: '可退上限（万分比）',
    description:
      '可退金额不超过实付的多少。10000 = 全额可退，5000 = 最多退一半。以「分」为单位按比例向下取整',
    type: 'number',
    default: 10000,
    min: 0,
    max: 10000,
    group: 'refund',
  },
  {
    key: 'refund.allowConsumedTask',
    label: '允许已消耗积分退款',
    description:
      '关闭后，订单发放的积分一旦被用掉（无法全额扣回）就拒绝退款，避免「先用再退」。已完成的任务产出不会因此回收',
    type: 'boolean',
    default: true,
    group: 'refund',
  },

  // ── 数据安全 ────────────────────────────────────────────────────────
  {
    key: 'backup.frequencyDays',
    label: '备份频次',
    description: '每隔多少天自动备份一次。可选 1 / 7 / 30',
    type: 'number',
    default: 1,
    enum: [1, 7, 30],
    group: 'backup',
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
    group: 'retention',
  },

  // ── 安全 ────────────────────────────────────────────────────────────
  {
    key: 'security.sessionTtlDays',
    label: '会话有效期',
    description: 'JWT 有效期，由环境变量 JWT_TTL 控制（当前 7d）。改代码里的环境变量并重启后生效',
    type: 'number',
    default: 7,
    min: 1,
    max: 30,
    group: 'security',
    readOnly: true,
  },
  {
    key: 'security.passwordMinLength',
    label: '密码最小长度',
    description: '代码内三个 DTO 统一为 6 位（注册 / 重置密码 / 改密码）。改动需发版',
    type: 'number',
    default: 6,
    min: 6,
    max: 32,
    group: 'security',
    readOnly: true,
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
  refund: '退款',
  payment: '支付',
  backup: '备份',
  retention: '保留期',
  security: '安全',
};

/** 可下发 C 端的设置项（`GET /api/v1/settings` 只返回这些） */
export const PUBLIC_SETTING_KEYS = SETTING_DEFS.filter((d) => d.public).map((d) => d.key);

/**
 * 按 SettingDef 校验并归一化一个值。
 *
 * 读路径与写路径**必须走同一个函数** —— 若写路径宽松、读路径严格，
 * 就会出现「能写进去、读出来却是默认值」的分叉，这正是本轮要消灭的病根。
 *
 * 抛 `AppError(40001)`，由调用方转成响应。
 */
export function validateSettingValue(
  def: SettingDef,
  raw: unknown,
): string | number | boolean {
  if (def.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new AppError(40001, `${def.label} 必须是布尔值`, 400);
  }

  if (def.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new AppError(40001, `${def.label} 必须是数字`, 400);
    }
    // 枚举优先于区间：`backup.frequencyDays` 只允许 1/7/30，
    // 区间校验放行 5 会让调度器静默跳过备份（静默停摆比报错危险得多）
    if (def.enum && !def.enum.includes(n)) {
      throw new AppError(40001, `${def.label} 只能是 ${def.enum.join(' / ')}`, 400);
    }
    if (def.min !== undefined && n < def.min) {
      throw new AppError(40001, `${def.label} 不得小于 ${def.min}`, 400);
    }
    if (def.max !== undefined && n > def.max) {
      throw new AppError(40001, `${def.label} 不得大于 ${def.max}`, 400);
    }
    return n;
  }

  const s = String(raw ?? '').trim();
  if (def.options && def.options.length > 0 && !def.options.includes(s)) {
    throw new AppError(40001, `${def.label} 只能是 ${def.options.join(' / ')}`, 400);
  }
  if (def.maxLength !== undefined && s.length > def.maxLength) {
    throw new AppError(40001, `${def.label} 长度不得超过 ${def.maxLength}`, 400);
  }
  return s;
}

/**
 * 解析库里的字符串值为目标类型。
 *
 * 存量数据可能格式不合法 (手工改过库)，此时回退到代码默认值 ——
 * 一个坏配置不应让整页设置加载失败。
 */
export function parseSettingValue(raw: string, def: SettingDef): string | number | boolean {
  try {
    return validateSettingValue(def, raw);
  } catch {
    return def.default;
  }
}

