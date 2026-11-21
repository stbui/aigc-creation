/**
 * 独立邮箱配置页的稳定键、通道元数据、业务事件分组与模板目录。
 *
 * 这里只声明展示层数据；真正的类型、默认值与校验仍由后端 `SETTING_DEFS`
 * 与系统设置接口负责。纯函数（通道标签、错误文案、就绪判定、模板占位符）
 * 统一放在 `./utils`。
 *
 * 模板编码必须与后端发送链路保持一致：
 *   · 账号与安全邮件由 EmailService 读取；
 *   · 业务通知邮件由 NotificationsService 读取。
 *
 * 模板默认文案只用于「尚未创建模板」时的编辑起点和预览，不会覆盖数据库中
 * 已经保存的模板。安全邮件使用 `{{变量}}`，业务通知沿用既有的 `{变量}`。
 */

import {
  CircleX,
  Cloud,
  Code2,
  Coins,
  CreditCard,
  Crown,
  KeyRound,
  Megaphone,
  MessagesSquare,
  Server,
  ServerCog,
  ShieldCheck,
  Terminal,
  UserPlus,
} from 'lucide-react';

import type {
  EmailFieldCopy,
  EmailTemplateGroup,
  EventGroupMeta,
  ProviderMeta,
} from './types';

export const EMAIL_GROUP_KEY = 'email';

export const EMAIL_KEYS = {
  enabled: 'email.enabled',
  provider: 'email.provider',
  from: 'email.from',
  fromAlias: 'email.fromAlias',
  smtpHost: 'email.smtpHost',
  smtpPort: 'email.smtpPort',
  smtpSecure: 'email.smtpSecure',
  smtpUser: 'email.smtpUser',
  smtpPassword: 'email.smtpPassword',
  httpApiUrl: 'email.httpApiUrl',
  httpApiKey: 'email.httpApiKey',
  aliyunAccessKeyId: 'email.aliyunAccessKeyId',
  aliyunAccessKeySecret: 'email.aliyunAccessKeySecret',
  aliyunDmAccountName: 'email.aliyunDmAccountName',
  aliyunDmAddressType: 'email.aliyunDmAddressType',
  eventWelcome: 'email.events.welcome',
  eventPaymentSuccess: 'email.events.paymentSuccess',
  eventCreditGranted: 'email.events.creditGranted',
  eventTicketReply: 'email.events.ticketReply',
  eventTaskFailed: 'email.events.taskFailed',
  eventMembershipExpired: 'email.events.membershipExpired',
  eventBroadcast: 'email.events.broadcast',
} as const;

export const ALL_EMAIL_KEYS = new Set<string>(Object.values(EMAIL_KEYS));

export const PROVIDERS: ProviderMeta[] = [
  {
    value: 'env',
    label: '部署环境配置',
    shortLabel: '部署环境',
    description: '沿用部署环境中已配置的邮件服务',
    detail:
      '适合由运维统一管理邮件服务凭据。本页仍可设置发件地址和发件人名称，并控制业务邮件开关。',
    icon: ServerCog,
  },
  {
    value: 'console',
    label: '本地记录',
    shortLabel: '本地记录',
    description: '仅记录邮件内容，不实际发送',
    detail:
      '适用于开发和联调。邮件只会保存为本地记录，不会送达用户收件箱，也不能用于验证真实发信能力。',
    icon: Terminal,
  },
  {
    value: 'smtp',
    label: 'SMTP 邮箱',
    shortLabel: 'SMTP',
    description: '通过 163、腾讯企业邮等邮箱服务发送',
    detail:
      '163 邮箱推荐参数：服务器 smtp.163.com，端口 465，开启 SSL/TLS 直连，账号填写完整邮箱地址，密码填写客户端授权码。请先在 163 网页版开启 SMTP 服务。',
    icon: Server,
  },
  {
    value: 'http',
    label: '自定义邮件接口',
    shortLabel: '邮件接口',
    description: '通过已完成对接的邮件服务接口发送',
    detail:
      '需填写接口地址和访问密钥。系统会按约定格式提交发件地址、收件人、主题与正文。',
    icon: Code2,
  },
  {
    value: 'aliyun',
    label: '阿里云邮件推送',
    shortLabel: '阿里云',
    description: '通过阿里云邮件推送服务发送',
    detail:
      '需填写已启用的 AccessKey 和已审核的发信地址。建议使用仅授予邮件推送权限的最小权限子账号。',
    icon: Cloud,
  },
];

/* 通道名与错误文案是「消息通知」与「邮箱配置」两页共用的展示口径，
 * 实现在 `src/lib/email-status.ts`，这里只转出给本目录使用。 */
export {
  EMAIL_ERROR_COPY,
  EMAIL_PROVIDER_LABELS,
  SMS_PROVIDER_LABELS,
} from '../../../lib/email-status';

export const EVENT_GROUPS: EventGroupMeta[] = [
  {
    title: '账号与安全',
    icon: UserPlus,
    note:
      '注册欢迎邮件可单独控制；注册验证码与找回密码属于安全邮件，仅受邮件总开关控制，不受本组业务开关影响。',
    items: [{ key: EMAIL_KEYS.eventWelcome, icon: UserPlus }],
  },
  {
    title: '交易与积分',
    icon: CreditCard,
    note:
      '支付成功或积分到账后通知用户。邮件发送失败不会影响支付结果、积分入账或订单状态。',
    items: [
      { key: EMAIL_KEYS.eventPaymentSuccess, icon: CreditCard },
      { key: EMAIL_KEYS.eventCreditGranted, icon: Coins },
    ],
  },
  {
    title: '服务通知',
    icon: MessagesSquare,
    note:
      '用户工单获得公开回复、生成任务失败或会员到期时发送通知。内部备注不会触发邮件。',
    items: [
      { key: EMAIL_KEYS.eventTicketReply, icon: MessagesSquare },
      { key: EMAIL_KEYS.eventTaskFailed, icon: CircleX },
      { key: EMAIL_KEYS.eventMembershipExpired, icon: Crown },
    ],
  },
  {
    title: '运营触达',
    icon: Megaphone,
    note:
      '开启后，后台发送活动消息时可选择同时发送邮件；每次发送仍需在消息通知页手动勾选。',
    items: [{ key: EMAIL_KEYS.eventBroadcast, icon: Megaphone }],
  },
];

export const EMAIL_FIELD_COPY: Record<string, EmailFieldCopy> = {
  [EMAIL_KEYS.from]: {
    label: '发件地址',
    hint:
      '用户在收件箱中看到的发件邮箱。选择 SMTP 邮箱时留空将使用 SMTP 登录账号；163 邮箱应填写完整邮箱地址。',
    placeholder: 'yourname@163.com',
  },
  [EMAIL_KEYS.fromAlias]: {
    label: '发件人名称',
    hint: '显示在邮件客户端中的发件名称，例如“货觉AI”。留空时仅显示发件地址。',
    placeholder: '例如：货觉AI',
  },
  [EMAIL_KEYS.smtpHost]: {
    label: 'SMTP 服务器',
    hint: '163 邮箱填写 smtp.163.com。其他邮箱请使用服务商提供的官方 SMTP 服务器地址。',
    placeholder: 'smtp.163.com',
  },
  [EMAIL_KEYS.smtpPort]: {
    label: 'SMTP 端口',
    hint: '163 邮箱 SSL 直连使用 465。若服务商要求 STARTTLS，通常使用 587 并关闭 SSL/TLS 直连。',
  },
  [EMAIL_KEYS.smtpSecure]: {
    label: 'SSL/TLS 直连',
    hint: '465 端口应开启；587 等 STARTTLS 端口应关闭。端口与加密方式不匹配时通常会连接失败。',
  },
  [EMAIL_KEYS.smtpUser]: {
    label: 'SMTP 登录账号',
    hint: '填写完整邮箱地址，例如 yourname@163.com。该账号用于 SMTP 身份认证。',
    placeholder: 'yourname@163.com',
  },
  [EMAIL_KEYS.smtpPassword]: {
    label: 'SMTP 客户端授权码',
    hint:
      '填写 163 网页版“设置 → POP3/SMTP/IMAP”中生成的客户端授权码，不能使用网页登录密码。授权码加密保存，页面不会回显明文。',
    placeholder: '请输入客户端授权码',
  },
  [EMAIL_KEYS.httpApiUrl]: {
    label: '邮件接口地址',
    hint: '填写已完成对接的邮件服务发送接口地址。选择自定义邮件接口时必填。',
    placeholder: '请输入完整的接口地址',
  },
  [EMAIL_KEYS.httpApiKey]: {
    label: '接口访问密钥',
    hint:
      '用于调用邮件发送接口。密钥加密保存，页面不会回显明文；留空表示保持当前密钥不变。',
    placeholder: '请输入接口访问密钥',
  },
  [EMAIL_KEYS.aliyunAccessKeyId]: {
    label: '阿里云 AccessKey ID',
    hint:
      '阿里云邮件推送的身份标识。建议使用仅授予邮件推送权限的子账号。密钥加密保存，页面不会回显明文。',
    placeholder: '请输入 AccessKey ID',
  },
  [EMAIL_KEYS.aliyunAccessKeySecret]: {
    label: '阿里云 AccessKey Secret',
    hint:
      '阿里云邮件推送的访问密钥。密钥加密保存，页面不会回显明文；留空表示保持当前密钥不变。',
    placeholder: '请输入 AccessKey Secret',
  },
  [EMAIL_KEYS.aliyunDmAccountName]: {
    label: '阿里云发信地址',
    hint:
      '填写阿里云邮件推送控制台已完成审核的发信地址。未配置时无法使用阿里云通道。',
    placeholder: '请输入已审核的发信地址',
  },
  [EMAIL_KEYS.aliyunDmAddressType]: {
    label: '阿里云地址类型',
    hint:
      '用于阿里云邮件推送的发信类型。通常选择“随机账号”；仅在服务商明确要求批量发信时切换。',
  },
  [EMAIL_KEYS.eventWelcome]: {
    label: '注册欢迎邮件',
    hint: '用户注册成功后发送欢迎与账号使用提示。验证码和找回密码不受此开关影响。',
  },
  [EMAIL_KEYS.eventPaymentSuccess]: {
    label: '支付成功邮件',
    hint: '订单支付成功后发送金额、订单号与到账信息。邮件失败不影响支付与积分入账。',
  },
  [EMAIL_KEYS.eventCreditGranted]: {
    label: '积分到账邮件',
    hint: '积分实际到账后通知用户。邮件失败不影响积分入账。',
  },
  [EMAIL_KEYS.eventTicketReply]: {
    label: '工单回复邮件',
    hint: '客服公开回复工单后通知用户；内部备注不会触发邮件。',
  },
  [EMAIL_KEYS.eventTaskFailed]: {
    label: '任务失败邮件',
    hint: '生成任务失败且积分处理完成后通知用户。',
  },
  [EMAIL_KEYS.eventMembershipExpired]: {
    label: '会员到期邮件',
    hint: '会员到期后通知用户。',
  },
  [EMAIL_KEYS.eventBroadcast]: {
    label: '活动广播邮件',
    hint: '后台发送活动消息时可选择同时发送邮件；实际发送仍以消息通知页的勾选项为准。',
  },
};

export const ALIYUN_ADDRESS_TYPE_LABELS: Record<string, string> = {
  '1': '随机账号（推荐）',
  '0': '批量发信',
};

export const EMAIL_TEMPLATE_GROUPS: EmailTemplateGroup[] = [
  {
    key: 'security',
    title: '账号与安全',
    note: '验证码与找回密码属于安全邮件。即使停用自定义模板，系统仍会使用内置文案发送，不会中断注册或密码重置。',
    templates: [
      {
        code: 'email_verification',
        label: '注册邮箱验证码',
        description: '用户注册时验证邮箱归属。正文必须保留验证码变量，建议同时说明有效期。',
        icon: ShieldCheck,
        syntax: 'double',
        defaultSubject: '【货觉AI】邮箱验证码',
        defaultBody: [
          '你的货觉AI邮箱验证码是：{{code}}',
          '',
          '验证码 {{expiresMinutes}} 分钟内有效，仅可使用一次。',
          '如果不是你本人操作，请忽略本邮件。',
          '',
          '—— 货觉AI 团队',
        ].join('\n'),
        variables: [
          { key: 'code', label: '6 位验证码', example: '482916' },
          { key: 'expiresMinutes', label: '有效分钟数', example: '10' },
        ],
        requiredVariable: 'code',
      },
      {
        code: 'password_reset',
        label: '找回密码',
        description: '用户申请重置密码时发送一次性链接。正文必须保留重置链接变量。',
        icon: KeyRound,
        syntax: 'double',
        defaultSubject: '【货觉AI】重置密码',
        defaultBody: [
          '{{name}}，你好：',
          '',
          '我们收到了重置货觉AI账号密码的请求。请在 {{expiresMinutes}} 分钟内打开下面的链接设置新密码：',
          '',
          '{{resetUrl}}',
          '',
          '如果不是你本人操作，请忽略本邮件，你的密码不会被修改。',
          '请求来源 IP：{{ip}}',
          '',
          '—— 货觉AI 团队',
        ].join('\n'),
        variables: [
          { key: 'name', label: '用户昵称', example: '小明' },
          { key: 'expiresMinutes', label: '有效分钟数', example: '30' },
          {
            key: 'resetUrl',
            label: '一次性重置链接',
            example: 'https://www.example.com/reset-password?token=example',
          },
          { key: 'ip', label: '请求来源 IP', example: '203.0.113.8' },
          { key: 'year', label: '当前年份', example: '2026' },
        ],
        requiredVariable: 'resetUrl',
      },
      {
        code: 'welcome',
        label: '注册欢迎邮件',
        description: '注册成功后介绍账号能力与下一步操作，受“注册欢迎邮件”业务开关控制。',
        icon: UserPlus,
        syntax: 'single',
        defaultSubject: '欢迎加入货觉AI',
        defaultBody: '{name}，欢迎加入货觉AI。\n\n你可以从创建作品、生成图片或查看会员权益开始。',
        variables: [{ key: 'name', label: '用户昵称', example: '小明' }],
      },
    ],
  },
  {
    key: 'transaction',
    title: '交易与积分',
    note: '交易类邮件使用订单与积分结算后的最终结果。邮件发送失败不会改变支付、入账或订单状态。',
    templates: [
      {
        code: 'payment_success',
        label: '支付成功',
        description: '订单支付完成后发送订单号、实付金额与到账积分。',
        icon: CreditCard,
        syntax: 'single',
        defaultSubject: '支付成功 · 订单 {orderNo}',
        defaultBody: '订单 {orderNo} 已支付 ¥{amount}，{credits} 积分已到账。',
        variables: [
          { key: 'orderNo', label: '订单号', example: 'P-20261113-001' },
          { key: 'amount', label: '实付金额', example: '99.00' },
          { key: 'credits', label: '到账积分', example: '1,000' },
        ],
      },
      {
        code: 'credit_granted',
        label: '积分到账',
        description: '积分实际入账后通知用户，不包含内部结算字段。',
        icon: Coins,
        syntax: 'single',
        defaultSubject: '积分到账',
        defaultBody: '本次获得 {credits} 积分。',
        variables: [{ key: 'credits', label: '到账积分', example: '500' }],
      },
    ],
  },
  {
    key: 'service',
    title: '服务通知',
    note: '服务状态变化会优先保障站内消息，邮件作为补充触达；用户仍可在站内查看完整记录。',
    templates: [
      {
        code: 'ticket_reply',
        label: '工单回复',
        description: '客服公开回复工单后发送工单编号与查看入口；内部备注不会触发邮件。',
        icon: MessagesSquare,
        syntax: 'single',
        defaultSubject: '工单 {ticketNo} 有新回复',
        defaultBody: '工单 {ticketNo} 已由客服回复，请登录货觉AI查看详情。',
        variables: [{ key: 'ticketNo', label: '工单编号', example: 'T-20261113-008' }],
      },
      {
        code: 'task_failed',
        label: '任务失败',
        description: '生成任务失败且积分处理完成后发送能力名称与失败原因。',
        icon: CircleX,
        syntax: 'single',
        defaultSubject: '生成失败 · {capability}',
        defaultBody: '任务「{capability}」执行失败（{reason}）。\n\n积分处理结果请查看任务账单。',
        variables: [
          { key: 'capability', label: '能力名称', example: '图片生成' },
          { key: 'reason', label: '失败原因', example: '上游服务超时' },
        ],
      },
      {
        code: 'membership_expired',
        label: '会员到期',
        description: '会员权益到期后提示续费与权益变化。',
        icon: Crown,
        syntax: 'single',
        defaultSubject: '会员已到期',
        defaultBody: '你的会员已于 {date} 到期。续费后可继续享受会员权益。',
        variables: [{ key: 'date', label: '到期日期', example: '2026-11-30' }],
      },
    ],
  },
  {
    key: 'marketing',
    title: '运营触达',
    note: '活动邮件仅在消息通知页明确勾选“同时发送邮件”且邮件总开关开启时发送。',
    templates: [
      {
        code: 'broadcast',
        label: '活动广播',
        description: '统一控制活动邮件的主题与署名结构，标题和正文由每次广播内容提供。',
        icon: Megaphone,
        syntax: 'single',
        defaultSubject: '【货觉AI】{title}',
        defaultBody: '{body}\n\n—— 货觉AI 团队',
        variables: [
          { key: 'title', label: '活动标题', example: '双十一活动已开启' },
          { key: 'body', label: '活动正文', example: '登录货觉AI，查看本月会员与积分活动。' },
          { key: 'name', label: '用户昵称', example: '小明' },
        ],
      },
    ],
  },
];

export const EMAIL_TEMPLATES = EMAIL_TEMPLATE_GROUPS.flatMap((group) => group.templates);

export const EMAIL_TEMPLATE_BY_CODE = new Map(
  EMAIL_TEMPLATES.map((template) => [template.code, template]),
);
