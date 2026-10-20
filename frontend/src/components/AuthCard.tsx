import { useEffect, useRef, useState } from 'react';
import { Form, Input, Button, App } from 'antd';
import type { InputRef } from 'antd';
import { Mail, Lock, User, X } from 'lucide-react';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { DEMO_CREDENTIALS } from '../lib/constants';

interface AuthForm {
  email: string;
  password: string;
  name?: string;
}

/**
 * 登录卡本体 —— 1:1 复刻参考站 ijihua.cn 的登录弹窗 `auth-card-split`
 * (2026-10-19 实拍 1280×900, 全部字面值见 `docs/login-design.md` §2)。
 *
 * 2026-10-19 拆成组件: 「路由对外开放 + 登录挂在顶栏按钮」后, 同一张卡有两个宿主 ——
 *   - `LoginModal`: 顶栏「登录/注册」唤起 (主路径, 与参考站同构)
 *   - `/login` 独立页: 深链接 / 分享 / 兜底跳转 (保留, 不删路由)
 *
 * 诚实差异 (本地无对应能力, 已如实标注, 不做假实现):
 *   - 扫码登录 / 短信登录: 无微信扫码通道与短信通道 → tab 置灰 + 悬浮说明
 *   - 左栏礼盒插画与底图: 参考站用位图, 本地不引第三方图片资源,
 *     改用内联 SVG + CSS 渐变 (同 ToolEmptyIllustration 纪律)
 *   - 第三方登录钮 (参考站 .auth-google-button): 本地无 → 该位置留给「填充演示账号」
 *   - 注册: 参考站无独立注册入口 (走短信/扫码), 本地演示账号体系需要注册 → 保留文字链接切换
 */

/** 参考站左栏两行礼遇 (auth-showcase-benefit-row × 3 / × 4) 的本地化文案 */
const BENEFIT_GROUPS: Array<{ key: 'signup' | 'usage'; items: string[] }> = [
  { key: 'signup', items: ['新用户注册', '老用户签到', '每邀请 1 位好友'] },
  { key: 'usage', items: ['AI 生图', 'AI 修图', 'AI 抠图', '去水印'] },
];

function benefitValue(group: string, item: string): string {
  if (group === 'signup') {
    if (item === '新用户注册') return '送 100 积分';
    if (item === '老用户签到') return '送 150 积分';
    return '送 600 积分';
  }
  if (item === 'AI 生图') return '10 积分 / 张';
  if (item === 'AI 修图') return '5 积分 / 张';
  return '永久免费';
}

/** tab 顺序与参考站一致 (扫码 / 短信 / 账号); 仅「账号登录」本地可用 */
const TABS = [
  { key: 'qr', label: '扫码登录', enabled: false, reason: '本地演示未接入微信扫码通道' },
  { key: 'sms', label: '短信登录', enabled: false, reason: '本地演示未接入短信服务' },
  { key: 'account', label: '账号登录', enabled: true, reason: '' },
] as const;

export interface AuthCardProps {
  /** 登录成功回调 (弹窗宿主据此关闭并让页面刷新数据) */
  onSuccess: () => void;
  /** 关闭/取消回调 */
  onCancel?: () => void;
}

export function AuthCard({ onSuccess, onCancel }: AuthCardProps) {
  const { message } = App.useApp();
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<AuthForm>();
  const emailRef = useRef<InputRef>(null);

  // 弹窗打开时把焦点落到账号输入框 (antd Modal 默认会聚焦第一个可聚焦元素 = 激活 tab),
  // 用户可直接敲键盘; 关闭时归还焦点由 Modal 处理。
  useEffect(() => {
    const t = window.setTimeout(() => emailRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  const fillDemo = () => {
    form.setFieldsValue(DEMO_CREDENTIALS);
  };

  const onFinish = async (values: AuthForm) => {
    setSubmitting(true);
    try {
      const res =
        mode === 'login'
          ? await authApi.login({ email: values.email, password: values.password })
          : await authApi.register({
              email: values.email,
              password: values.password,
              name: values.name,
            });
      // token 落库 + 内存态同步 (AuthProvider), 之后所有壳内页面立即可用
      login(res.accessToken, values.email, res.user?.role);
      message.success(mode === 'login' ? '登录成功' : '注册成功，已自动登录');
      onSuccess();
    } catch (e) {
      message.error((e as Error).message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // 840x478 双栏卡: 参考站 .auth-card-split (radius 32 / grid 420 420 / shadow 0 20px 60px)
    <section className="login-split">
      {/* ── 左栏: 礼宾面板 (参考站 .auth-showcase) ── */}
      <aside className="login-showcase" aria-hidden>
        <div className="login-showcase-bg" />
        <LoginGiftArt />
        <div className="login-showcase-content">
          <h1 className="login-showcase-title">登录即享好礼</h1>
          <div className="login-showcase-benefits">
            {BENEFIT_GROUPS.map((g) => (
              <div key={g.key} className="login-benefit">
                {g.items.map((it) => (
                  <div key={it} className="login-benefit-row">
                    <span className="login-benefit-name">{it}</span>
                    <span className="login-benefit-value">{benefitValue(g.key, it)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── 右栏: 表单面板 (参考站 .auth-form-panel, padding 32px 40px) ── */}
      <div className="login-form-panel">
        {/* 弹窗宿主里由遮罩点击关闭; 独立页里没有遮罩可关 → 关闭 = 回上一页 */}
        {onCancel && (
          <button type="button" className="login-close" aria-label="关闭" onClick={onCancel}>
            <X size={16} />
          </button>
        )}

        <div className="login-panel-inner">
          <div className="login-tabs" role="tablist" aria-label="登录方式">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.enabled && mode === 'login'}
                disabled={!t.enabled}
                title={t.reason || undefined}
                className={`login-tab${t.key === 'account' ? ' is-active' : ''}${t.enabled ? '' : ' is-disabled'}`}
                onClick={() => t.enabled && setMode('login')}
              >
                {t.label}
              </button>
            ))}
          </div>

          <Form
            form={form}
            layout="vertical"
            initialValues={DEMO_CREDENTIALS}
            onFinish={onFinish}
            requiredMark={false}
            className="login-form"
          >
            {mode === 'register' && (
              <Form.Item
                name="name"
                label="昵称（选填）"
                className="login-field"
                hidden
              >
                <Input prefix={<User size={15} />} placeholder="展示名称" maxLength={20} />
              </Form.Item>
            )}
            <Form.Item
              name="email"
              label="邮箱"
              className="login-field"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '邮箱格式不正确' },
              ]}
            >
              <Input ref={emailRef} prefix={<Mail size={15} />} placeholder="账号（邮箱）" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              className="login-field"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少 6 位' },
              ]}
            >
              <Input.Password
                prefix={<Lock size={15} />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>

            {/* 参考站 .auth-submit: 340x48 / linear-gradient(90deg,#8064f6,#5546d8) / 14px 600 / radius 8 */}
            <Button type="primary" htmlType="submit" block className="login-submit" loading={submitting}>
              {mode === 'login' ? '登录' : '注册并登录'}
            </Button>
          </Form>

          {/* 参考站此位是第三方登录钮 (.auth-google-button 340x48 白底描边);
              本地无第三方通道, 留给「填充演示账号」—— 本地演示自有的诚实功能 */}
          {mode === 'login' && (
            <Button type="link" block onClick={fillDemo} className="login-demo-fill">
              填充演示账号
            </Button>
          )}

          {/* 参考站 .auth-agreement: 12px/400 #86909C, 内嵌协议链接 */}
          <p className="login-agreement">
            登录即代表我已同意
            <a href="/legal/user-agreement">用户协议</a>
            <a href="/legal/privacy">个人信息保护政策</a>
            <span className="login-agreement-note">账号规则</span>
          </p>

          {/* 注册入口: 参考站无 (走短信/扫码), 本地演示账号体系需要 → 保留文字链接 */}
          <div className="login-switch">
            {mode === 'login' ? (
              <span>
                还没有账号？<a onClick={() => setMode('register')}>立即注册</a>
              </span>
            ) : (
              <span>
                已有账号？<a onClick={() => setMode('login')}>去登录</a>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 左栏礼盒插画 —— 原创内联 SVG (参考站 .auth-showcase-gift 实测 221x214)。
 * 不引参考站位图资源, 同 ToolEmptyIllustration 的纪律。
 * 参考站原图是紫色礼盒 + 金币 + 宝石的插画, 这里用同构的矢量版本重绘。
 */
function LoginGiftArt() {
  return (
    <svg
      className="login-showcase-gift"
      width="221"
      height="214"
      viewBox="0 0 221 214"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="lg-box" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6d5bd8" />
        </linearGradient>
        <linearGradient id="lg-lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9a2fb" />
          <stop offset="1" stopColor="#7c6ae0" />
        </linearGradient>
        <linearGradient id="lg-coin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f5a524" />
        </linearGradient>
      </defs>

      {/* 投影 */}
      <ellipse cx="112" cy="186" rx="66" ry="11" fill="#5546d8" opacity="0.14" />

      {/* 盒身 */}
      <rect x="54" y="92" width="116" height="88" rx="12" fill="url(#lg-box)" />
      {/* 盒盖 */}
      <rect x="42" y="70" width="140" height="30" rx="10" fill="url(#lg-lid)" />
      {/* 竖丝带 */}
      <rect x="100" y="70" width="22" height="110" fill="#ffd666" opacity="0.95" />
      <rect x="100" y="70" width="7" height="110" fill="#ffe9a8" opacity="0.9" />

      {/* 蝴蝶结 */}
      <path d="M111 70 C 96 50, 68 44, 66 58 C 64 70, 90 72, 111 70 Z" fill="#8b7ae8" />
      <path d="M111 70 C 126 50, 154 44, 156 58 C 158 70, 132 72, 111 70 Z" fill="#7a68dd" />
      <circle cx="111" cy="68" r="8" fill="#a78bfa" />

      {/* 金币 */}
      <circle cx="58" cy="128" r="17" fill="url(#lg-coin)" />
      <path
        d="M58 119 v18 M52 124 h12 M52 132 h12"
        stroke="#b45309"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="166" cy="132" r="13" fill="url(#lg-coin)" />
      <path
        d="M166 125 v14 M162 129 h8 M162 135 h8"
        stroke="#b45309"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="74" cy="160" r="9" fill="url(#lg-coin)" />

      {/* 宝石点缀 */}
      <path d="M186 66 l5 11 11 5 -11 5 -5 11 -5 -11 -11 -5 11 -5 Z" fill="#67e8f9" opacity="0.9" />
      <circle cx="30" cy="108" r="4" fill="#ffffff" opacity="0.75" />
      <circle cx="196" cy="104" r="3" fill="#ffffff" opacity="0.6" />
      <circle cx="40" cy="46" r="2.5" fill="#ffffff" opacity="0.55" />
    </svg>
  );
}