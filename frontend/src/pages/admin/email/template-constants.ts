/**
 * 邮箱配置工作台的模板目录。
 *
 * 模板编码必须与后端发送链路保持一致：
 *   · 账号与安全邮件由 EmailService 读取；
 *   · 业务通知邮件由 NotificationsService 读取。
 *
 * 这里的默认文案只用于“尚未创建模板”时的编辑起点和预览，不会覆盖数据库中
 * 已经保存的模板。安全邮件使用 `{{变量}}`，业务通知沿用既有的 `{变量}`。
 */

import {
  CircleX,
  Coins,
  CreditCard,
  Crown,
  KeyRound,
  Megaphone,
  MessagesSquare,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

export interface EmailTemplateVariable {
  key: string;
  label: string;
  example: string;
}

export interface EmailTemplateMeta {
  code: string;
  label: string;
  description: string;
  icon: LucideIcon;
  syntax: 'single' | 'double';
  defaultSubject: string;
  defaultBody: string;
  variables: EmailTemplateVariable[];
  /** 安全邮件必须保留的变量；保存前由页面与后端共同校验。 */
  requiredVariable?: string;
}

export interface EmailTemplateGroup {
  key: string;
  title: string;
  note: string;
  templates: EmailTemplateMeta[];
}

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

/** 生成界面展示用的准确占位符写法。 */
export function templatePlaceholder(meta: EmailTemplateMeta, key: string): string {
  return meta.syntax === 'double' ? `{{${key}}}` : `{${key}}`;
}

/** 用示例值渲染预览；未知变量原样保留，便于发现拼写错误。 */
export function renderEmailTemplatePreview(meta: EmailTemplateMeta, text: string): string {
  const values = new Map(meta.variables.map((variable) => [variable.key, variable.example]));
  const pattern = meta.syntax === 'double' ? /\{\{\s*(\w+)\s*\}\}/g : /\{(\w+)\}/g;
  return text.replace(pattern, (whole, key: string) => values.get(key) ?? whole);
}
