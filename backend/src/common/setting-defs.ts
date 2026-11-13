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
export type SettingValue = string | number | boolean | null;

export interface SettingDef {

  /** 键名。点号分隔，`<分组>.<项>` —— 分组段必须与 `group` 一致 */
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  /** 代码默认值。与运行时常量的兜底值必须一致 */
  default: SettingValue;
  /** 数字项是否允许显式留空；留空表示“不限”，与恢复代码默认值不同 */
  nullable?: boolean;
  min?: number;
  max?: number;
  /** 数字项是否只接受整数 */
  integer?: boolean;
  maxLength?: number;
  /** 允许取值的枚举。命中时优先于 min/max —— 调度器等消费方按白名单判定 */
  enum?: number[];
  /** 字符串型可选值白名单（如币种 CNY / USD）。命中时按枚举校验 */
  options?: string[];
  /** 字符串枚举值的展示文案；仅影响后台，不改变落库值 */
  optionLabels?: Record<string, string>;
  /** 后台控件覆盖；缺省为文本输入 */
  control?: 'text' | 'password' | 'image-upload' | 'image-formats';
  /**
   * 敏感项：值在库内加密，后台读取只返回 hasSecret，不回显明文。
   * 留空提交表示保留原值；需要清空时走 `clears` 删除运行时覆盖。
   */
  sensitive?: boolean;
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
  | 'upload'
  | 'generate'
  | 'refund'
  | 'payment'
  | 'email'
  | 'backup'
  | 'retention';

export const SETTING_DEFS: SettingDef[] = [
  // ── 上传 ────────────────────────────────────────────────────────────
  {
    key: 'upload.maxSizeMb',
    label: '单文件大小上限（MB）',
    description:
      '限制单张图片的字节数，填写 1–100 的整数 MB。前端会提前提示，后端仍按此值校验。',
    type: 'number',
    default: 10,
    min: 1,
    max: 100,
    integer: true,
    group: 'upload',
    public: true,
  },
  {
    key: 'upload.maxPixels',
    label: '单图像素总量上限',
    description:
      '限制宽 × 高的像素总数，填写 1,000,000–200,000,000 的整数。超过后后端拒绝上传，避免解码超大图片。',
    type: 'number',
    default: 40_000_000,
    min: 1_000_000,
    max: 200_000_000,
    integer: true,
    group: 'upload',
    public: true,
  },
  {
    key: 'upload.allowedTypes',
    label: '允许的图片格式',
    description:
      '至少保留一种格式。后端按文件内容识别真实格式，并把 JPEG 统一按 JPG 保存。',
    type: 'string',
    default: 'jpg,png,webp',
    maxLength: 200,
    control: 'image-formats',
    group: 'upload',
    public: true,
  },

  // ── 生成 ────────────────────────────────────────────────────────────
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
      '开启后，账单清扫任务每 5 分钟检查一次：结果不明、运行超过 40 分钟，或任务已失败/取消但仍预留的冻结积分会自动退回。已出作品或正在补交付的订单不自动退回；关闭后保留在待核对队列，由后台人工处理。',
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
  {
    key: 'payment.enabled',
    label: '启用支付',
    description:
      '关闭后 C 端不展示任何支付方式，也不能发起渠道支付。0 元订单的领取入口不受影响',
    type: 'boolean',
    default: false,
    group: 'payment',
  },
  {
    key: 'payment.productNamePrefix',
    label: '商品名前缀',
    description: '支付页面展示的商品名前缀，例如品牌名。留空表示不加前缀',
    type: 'string',
    default: '',
    maxLength: 40,
    group: 'payment',
  },
  {
    key: 'payment.productNameSuffix',
    label: '商品名后缀',
    description: '支付页面展示的商品名后缀，例如“元”。留空表示不加后缀',
    type: 'string',
    default: '',
    maxLength: 20,
    group: 'payment',
  },
  {
    key: 'payment.minAmountYuan',
    label: '最低金额（元）',
    description: '单笔充值允许的最低实付金额。订单金额以分为单位核算，本项按元填写',
    type: 'number',
    default: 1,
    min: 0.01,
    group: 'payment',
  },
  {
    key: 'payment.maxAmountYuan',
    label: '最高金额（元）',
    description: '单笔充值允许的最高实付金额。留空表示不限制',
    type: 'number',
    default: null,
    nullable: true,
    min: 0.01,
    group: 'payment',
  },
  {
    key: 'payment.dailyLimitYuan',
    label: '每日限额（元）',
    description:
      '每用户每个自然日（Asia/Shanghai）的累计充值上限；已支付与仍在等待支付的订单都会占用额度。留空表示不限制',
    type: 'number',
    default: null,
    nullable: true,
    min: 0.01,
    group: 'payment',
  },
  {
    key: 'payment.orderTtlMinutes',
    label: '订单超时时间（分钟）',
    description: '待支付订单超过该时长后由后台任务查单并关闭。至少 1 分钟',
    type: 'number',
    default: 30,
    min: 1,
    max: 1440,
    group: 'payment',
  },
  {
    key: 'payment.maxPendingOrders',
    label: '最大待支付订单数',
    description: '同一用户同时保留的待支付订单上限，超过后拒绝创建新订单',
    type: 'number',
    default: 3,
    min: 1,
    max: 100,
    group: 'payment',
  },
  {
    key: 'payment.cancelLimitEnabled',
    label: '启用取消频率限制',
    description: '启用后，用户主动取消待支付订单会占用窗口内额度；管理员与后台超时关单不计入',
    type: 'boolean',
    default: false,
    group: 'payment',
  },
  {
    key: 'payment.cancelWindowMode',
    label: '取消窗口模式',
    description: '滚动窗口按最近一段时间统计；固定窗口按时间单位对齐，窗口内次数达到上限后等待下一窗口',
    type: 'string',
    options: ['rolling', 'fixed'],
    optionLabels: { rolling: '滚动窗口', fixed: '固定窗口' },
    default: 'rolling',
    group: 'payment',
  },
  {
    key: 'payment.cancelWindowSize',
    label: '取消时间窗口',
    description: '取消频率统计窗口长度，与下一项“窗口单位”组合使用',
    type: 'number',
    default: 10,
    min: 1,
    max: 10080,
    group: 'payment',
  },
  {
    key: 'payment.cancelWindowUnit',
    label: '取消窗口单位',
    description: '取消频率统计窗口的时间单位',
    type: 'string',
    options: ['minute', 'hour'],
    optionLabels: { minute: '分钟', hour: '小时' },
    default: 'minute',
    group: 'payment',
  },
  {
    key: 'payment.cancelLimitMax',
    label: '窗口内最大取消次数',
    description: '单个用户在统计窗口内允许成功主动取消的订单数',
    type: 'number',
    default: 5,
    min: 1,
    max: 1000,
    group: 'payment',
  },
  {
    key: 'payment.loadBalancingStrategy',
    label: '负载均衡策略',
    description: '同一支付来源存在多个服务商实例时的选择策略',
    type: 'string',
    options: ['round-robin', 'least-amount'],
    optionLabels: { 'round-robin': '轮询', 'least-amount': '最少金额' },
    default: 'round-robin',
    group: 'payment',
  },
  {
    key: 'payment.alipayMobilePrecreateDeepLink',
    label: '支付宝移动端当面付唤起',
    description:
      '仅对路由到支付宝官方的移动端订单生效：调用当面付获取动态二维码并尝试唤起支付宝 App，失败时展示二维码备用页。需先在支付宝应用开通当面付/扫码支付',
    type: 'boolean',
    default: false,
    group: 'payment',
  },
  {
    key: 'payment.helpImage',
    label: '帮助图片',
    description: '充值页面展示的客服二维码等图片，支持 PNG / JPEG / WebP。留空表示不展示',
    type: 'string',
    default: '',
    maxLength: 500,
    control: 'image-upload',
    group: 'payment',
    public: true,
  },
  {
    key: 'payment.helpText',
    label: '帮助文本',
    description: '充值页面展示的说明文字。留空表示不展示',
    type: 'string',
    default: '',
    maxLength: 1000,
    group: 'payment',
    public: true,
  },
  {
    key: 'payment.alipaySource',
    label: '支付宝前台来源',
    description:
      'C 端「支付宝」按钮唯一使用的服务商来源。未选择或所选渠道不可用时，前台隐藏该按钮，不会自动切换来源',
    type: 'string',
    options: ['unset', 'official', 'epay'],
    optionLabels: { unset: '未选择', official: '支付宝官方', epay: '易支付' },
    default: 'unset',
    group: 'payment',
  },
  {
    key: 'payment.wechatSource',
    label: '微信前台来源',
    description:
      'C 端「微信支付」按钮唯一使用的服务商来源。未选择或所选渠道不可用时，前台隐藏该按钮，不会自动切换来源',
    type: 'string',
    options: ['unset', 'official', 'epay'],
    optionLabels: { unset: '未选择', official: '微信官方', epay: '易支付' },
    default: 'unset',
    group: 'payment',
  },

  // ── 邮件 ────────────────────────────────────────────────────────────
  {
    key: 'email.enabled',
    label: '启用邮件通知',
    description:
      '总开关。关闭后注册验证码、找回密码、支付成功、工单回复与活动邮件都会停止真实投递；站内消息不受影响',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.provider',
    label: '投递通道',
    description:
      '选择邮件发送方式。“部署环境配置”沿用部署时设置的邮件服务；“SMTP 邮箱”支持 163 等标准 SMTP 服务；“本地记录”仅保存邮件内容，不实际发送；“自定义邮件接口”通过已对接的邮件服务接口发送；“阿里云邮件推送”通过阿里云邮件推送服务发送',
    type: 'string',
    options: ['env', 'smtp', 'console', 'http', 'aliyun'],
    optionLabels: {
      env: '部署环境配置',
      smtp: 'SMTP 邮箱',
      console: '本地记录',
      http: '自定义邮件接口',
      aliyun: '阿里云邮件推送',
    },
    default: 'env',
    group: 'email',
  },
  {
    key: 'email.from',
    label: '发件地址',
    description:
      '用户在收件箱中看到的发件邮箱。SMTP 通道留空时使用 SMTP 登录账号；163 邮箱应填写完整邮箱地址。自定义邮件接口直接使用；阿里云邮件推送必须使用控制台已审核的发信地址',
    type: 'string',
    default: '',
    maxLength: 200,
    group: 'email',
  },
  {
    key: 'email.fromAlias',
    label: '发件人名称',
    description: '邮件客户端展示的名称，如「货觉AI」。留空则只展示发件地址',
    type: 'string',
    default: '',
    maxLength: 60,
    group: 'email',
  },
  {
    key: 'email.smtpHost',
    label: 'SMTP 服务器',
    description:
      '选择 SMTP 邮箱时必填。163 邮箱填写 smtp.163.com；其他服务商请填写其官方 SMTP 服务器地址',
    type: 'string',
    default: '',
    maxLength: 200,
    group: 'email',
  },
  {
    key: 'email.smtpPort',
    label: 'SMTP 端口',
    description:
      'SMTP 服务端口。163 邮箱的 SSL 直连端口为 465；若服务商要求 STARTTLS，通常使用 587 并关闭 SSL 直连',
    type: 'number',
    default: 465,
    min: 1,
    max: 65535,
    group: 'email',
  },
  {
    key: 'email.smtpSecure',
    label: 'SSL/TLS 直连',
    description:
      '开启后从建立连接起即使用 TLS，适用于 163 邮箱的 465 端口。587 等 STARTTLS 端口应关闭此选项',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.smtpUser',
    label: 'SMTP 登录账号',
    description:
      '通常是完整邮箱地址，例如 yourname@163.com。163 邮箱必须先在网页版设置中开启 SMTP 服务',
    type: 'string',
    default: '',
    maxLength: 200,
    group: 'email',
  },
  {
    key: 'email.smtpPassword',
    label: 'SMTP 客户端授权码',
    description:
      '163 邮箱需填写在网页版“设置 → POP3/SMTP/IMAP”中生成的客户端授权码，不能填写网页登录密码。授权码加密保存，读取接口不会回显',
    type: 'string',
    default: '',
    maxLength: 1000,
    group: 'email',
    control: 'password',
    sensitive: true,
  },
  {
    key: 'email.httpApiUrl',
    label: '自定义邮件接口地址',
    description: '选择自定义邮件接口时必填。系统会按约定格式提交发件地址、收件人、主题与正文，并使用访问密钥完成身份验证',
    type: 'string',
    default: '',
    maxLength: 500,
    group: 'email',
  },
  {
    key: 'email.httpApiKey',
    label: '接口访问密钥',
    description: '仅加密保存，读取接口不会回显。留空表示保持已保存的密钥不变',
    type: 'string',
    default: '',
    maxLength: 1000,
    group: 'email',
    control: 'password',
    sensitive: true,
  },
  {
    key: 'email.aliyunAccessKeyId',
    label: '阿里云 AccessKey ID',
    description: '仅加密保存，读取接口不会回显。建议使用只授权邮件推送的最小权限子账号',
    type: 'string',
    default: '',
    maxLength: 500,
    group: 'email',
    control: 'password',
    sensitive: true,
  },
  {
    key: 'email.aliyunAccessKeySecret',
    label: '阿里云 AccessKey Secret',
    description: '仅加密保存，读取接口不会回显。留空表示保持已保存的密钥不变',
    type: 'string',
    default: '',
    maxLength: 1000,
    group: 'email',
    control: 'password',
    sensitive: true,
  },
  {
    key: 'email.aliyunDmAccountName',
    label: '阿里云发信地址',
    description: '阿里云邮件推送控制台已配置的发信地址；缺失时不能选择阿里云通道',
    type: 'string',
    default: '',
    maxLength: 200,
    group: 'email',
  },
  {
    key: 'email.aliyunDmAddressType',
    label: '阿里云地址类型',
    description: '1 = 随机账号（发信地址）；0 = 批量发信。通常保持 1',
    type: 'string',
    options: ['1', '0'],
    optionLabels: { '1': '随机账号（1）', '0': '批量发信（0）' },
    default: '1',
    group: 'email',
  },
  {
    key: 'email.events.welcome',
    label: '注册欢迎邮件',
    description: '注册成功后发送欢迎与账号使用提示',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.events.paymentSuccess',
    label: '支付成功邮件',
    description: '订单支付成功后发送金额、订单号与到账信息。邮箱发送失败不影响支付与积分入账',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.events.creditGranted',
    label: '积分到账邮件',
    description: '积分实际到账时发送通知',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.events.ticketReply',
    label: '工单回复邮件',
    description: '客服回复工单后通知用户。内部备注不会触发',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.events.taskFailed',
    label: '任务失败邮件',
    description: '生成任务失败并完成积分处理结果后通知用户',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.events.membershipExpired',
    label: '会员到期邮件',
    description: '会员到期状态迁移后通知用户',
    type: 'boolean',
    default: true,
    group: 'email',
  },
  {
    key: 'email.events.broadcast',
    label: '活动广播邮件',
    description: '后台广播时可同时投递邮件；实际是否发送仍由广播弹窗中的勾选项决定',
    type: 'boolean',
    default: true,
    group: 'email',
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
    label: '自动备份周期（天）',
    description:
      '每隔 1 / 7 / 30 天执行一次自动备份。调度器每 10 分钟检查一次，到期后的下一个检查周期执行。',
    type: 'number',
    default: 1,
    enum: [1, 7, 30],
    group: 'backup',
  },

];

export const SETTING_KEYS = SETTING_DEFS.map((d) => d.key);

export function findSettingDef(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((d) => d.key === key);
}

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  upload: '上传限制',
  generate: '运行与生成',
  refund: '退款',
  payment: '支付',
  email: '邮件',
  backup: '备份',
  retention: '保留期',
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
export function validateSettingValue(def: SettingDef, raw: unknown): SettingValue {
  if (def.nullable && (raw === null || raw === undefined)) return null;
  if (def.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new AppError(40001, `${def.label} 必须是布尔值`, 400);
  }

  if (def.type === 'number') {
    if (typeof raw === 'string' && raw.trim() === '') {
      if (def.nullable) return null;
      throw new AppError(40001, `${def.label} 必须是数字`, 400);
    }
    if (raw === null || raw === undefined) {
      throw new AppError(40001, `${def.label} 必须是数字`, 400);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new AppError(40001, `${def.label} 必须是数字`, 400);
    }
    if (def.integer && !Number.isInteger(n)) {
      throw new AppError(40001, `${def.label} 必须是整数`, 400);
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
export function parseSettingValue(raw: string, def: SettingDef): SettingValue {
  try {
    return validateSettingValue(def, raw);
  } catch {
    return def.default;
  }
}

