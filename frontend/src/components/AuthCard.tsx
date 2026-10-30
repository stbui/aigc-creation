import { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Input, Button, App, Checkbox } from 'antd';
import type { InputRef } from 'antd';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, X, Smartphone, ShieldCheck } from 'lucide-react';
import { authApi, legalApi, oauthAuthorizeUrl, type OAuthProviderInfo } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QrLoginPanel } from './QrLoginPanel';
import type { SmsPurpose } from '../types/api';

interface AuthForm {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  smsCode?: string;
  agreed?: boolean;
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
 *   - 扫码登录: 无微信扫码通道 → tab 置灰 + 悬浮说明
 *   - 左栏礼盒插画与底图: 参考站用位图, 本地不引第三方图片资源,
 *     改用内联 SVG + CSS 渐变 (同 ToolEmptyIllustration 纪律)
 *   - 第三方登录钮 (参考站 .auth-google-button): 无第三方通道 → 该位置留空
 *   - 注册: 参考站无独立注册入口 (走短信/扫码), 本项目账号体系需要注册 → 保留文字链接
 *
 * 2026-10-21 (B2) 变更:
 *   - 「短信登录」tab 启用 —— 后端已接短信通道 (console/http 适配器)
 *   - 登录态增加「忘记密码」
 *   - 注册增加可选手机号 + 短信验证码, 以及协议勾选
 */

/** 参考站左栏两行礼遇 (auth-showcase-benefit-row × 3 / × 4) 的本地化文案 */
const BENEFIT_GROUPS: Array<{ key: 'signup' | 'usage'; items: string[] }> = [
  { key: 'signup', items: ['新用户注册', '老用户签到', '每邀请 1 位好友'] },
  { key: 'usage', items: ['AI 生图', 'AI 修图', 'AI 抠图', '去水印'] },
];

/*
 * 权益数字必须与后端一致, 不能照抄参考站:
 *   · 注册不发积分 (auth.service 建号时不写 CreditLot);
 *   · 签到基础 5 分 (seed-marketing 的 CheckinRule), 第 3/7/15 天有加成;
 *   · 邀请是邀请人 200 / 被邀请人 100, 且首次付费才触发;
 *   · 生图价格按能力 0~40 不等 (matting/remove_watermark 为 0)。
 * 写死「注册送 100 / 签到送 150 / 邀请送 600」属于全站可见的虚假承诺。
 */
function benefitValue(group: string, item: string): string {
  if (group === 'signup') {
    if (item === '新用户注册') return '注册即可使用';
    if (item === '老用户签到') return '每日 5 积分起';
    return '邀请双方得积分';
  }
  if (item === 'AI 生图') return '10 积分起';
  if (item === 'AI 修图') return '5 积分起';
  return '免费';
}

/**
 * tab 顺序与参考站一致 (扫码 / 短信 / 账号)。
 *
 * 2026-10-21 (B8): 扫码 tab 启用 —— 走自有二维码通道 (`/auth/qr/*`),
 * 不依赖微信开放平台: 桌面建码 → 手机 (已登录) 扫码确认 → 桌面轮询换 JWT。
 */
const TABS = [
  { key: 'qr', label: '扫码登录', enabled: true, reason: '' },
  { key: 'sms', label: '短信登录', enabled: true, reason: '' },
  { key: 'account', label: '账号登录', enabled: true, reason: '' },
] as const;

type Mode = 'login' | 'register' | 'sms' | 'qr';

/** 验证码倒计时秒数。与后端 1 分钟/条的限流口径一致 (B5) */
const SMS_COUNTDOWN = 60;

export interface AuthCardProps {
  /** 登录成功回调 (弹窗宿主据此关闭并让页面刷新数据) */
  onSuccess: () => void;
  /** 关闭/取消回调 */
  onCancel?: () => void;
}

export function AuthCard({ onSuccess, onCancel }: AuthCardProps) {
  const { message } = App.useApp();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<AuthForm>();
  const emailRef = useRef<InputRef>(null);

  // 验证码发送状态
  const [sendingSms, setSendingSms] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);

  // 注册模式下手机号是选填的；只有填了才显示验证码输入框
  const phoneValue = Form.useWatch('phone', form);
  const needPhoneCode = mode === 'register' && Boolean(phoneValue);

  /*
   * 当前生效的用户协议版本号。
   *
   * 注册时勾选框只是前端校验；同意留痕必须把**真实版本号**发给后端，
   * 否则库里永远没有 ConsentRecord —— 合规审查时等于「用户没同意过」。
   * 拉不到就宁可不传：由后端决定不落库，而不是编一个版本号。
   */
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'register') return;
    let alive = true;
    legalApi
      .current('user-agreement')
      .then((doc) => {
        if (alive && doc?.version) setConsentVersion(doc.version);
      })
      .catch(() => {
        /* 法务文档未发布时保持 null，注册仍可进行 */
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  useEffect(() => {
    let alive = true;
    authApi
      .oauthProviders()
      .then((providers) => {
        if (alive) setOauthProviders(providers);
      })
      .catch(() => {
        if (alive) setOauthProviders([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 弹窗打开时把焦点落到账号输入框 (antd Modal 默认会聚焦第一个可聚焦元素 = 激活 tab),
  // 用户可直接敲键盘; 关闭时归还焦点由 Modal 处理。
  useEffect(() => {
    const t = window.setTimeout(() => emailRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  // 倒计时。依赖 countdown 自身，归零即停
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  /**
   * 发送短信验证码。
   *
   * `delivered=false` 表示后端走的是控制台通道（没配短信服务商）：
   * 必须如实告诉开发者「验证码在 logs/outbox/」，而不是假装发送成功，
   * 否则本地联调会陷入「为什么手机收不到」的死循环。
   */
  const handleSendSms = useCallback(
    async (purpose: SmsPurpose) => {
      const phone = form.getFieldValue('phone');
      if (!phone) {
        message.error('请先填写手机号');
        return;
      }
      setSendingSms(true);
      try {
        const res = await authApi.sendSms(phone, purpose);
        if (res.delivered) {
          message.success('验证码已发送，请查收短信');
        } else {
          message.warning('当前为控制台短信通道，验证码已写入后端 logs/outbox/sms-*.log');
        }
        setCountdown(SMS_COUNTDOWN);
      } catch (e) {
        message.error((e as Error).message || '验证码发送失败');
      } finally {
        setSendingSms(false);
      }
    },
    [form, message],
  );

  const onFinish = async (values: AuthForm) => {
    setSubmitting(true);
    try {
      if (mode === 'sms') {
        const res = await authApi.smsLogin({ phone: values.phone!, code: values.smsCode! });
        // 短信登录没有邮箱输入，用户身份以服务端返回为准
        login(res.accessToken, res.user?.email ?? values.phone!, res.user?.role);
        message.success('登录成功');
        onSuccess();
        return;
      }

      if (mode === 'login') {
        const res = await authApi.login({ email: values.email, password: values.password });
        login(res.accessToken, values.email, res.user?.role);
        message.success('登录成功');
        onSuccess();
        return;
      }

      // 注册：手机号选填，填了就必须带验证码（后端强校验归属）
      const res = await authApi.register({
        email: values.email,
        password: values.password,
        name: values.name,
        ...(values.phone ? { phone: values.phone, smsCode: values.smsCode } : {}),
        ...(consentVersion ? { consentVersion } : {}),
      });
      login(res.accessToken, values.email, res.user?.role);
      message.success('注册成功，已自动登录');
      onSuccess();
    } catch (e) {
      message.error((e as Error).message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setCountdown(0);
    form.resetFields(['password', 'name', 'phone', 'smsCode', 'agreed']);
  };

  const activeTab = mode === 'qr' ? 'qr' : mode === 'sms' ? 'sms' : 'account';

  /** 验证码输入框 + 获取按钮。两个用途共用同一段 UI */
  const codeField = (purpose: SmsPurpose) => (
    <Form.Item
      name="smsCode"
      label="验证码"
      className="login-field"
      rules={[{ required: true, message: '请输入验证码' }]}
    >
      <div className="login-code-row">
        <Input
          prefix={<ShieldCheck size={15} />}
          placeholder="6 位验证码"
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <Button
          className="login-code-btn"
          onClick={() => handleSendSms(purpose)}
          loading={sendingSms}
          disabled={countdown > 0}
        >
          {countdown > 0 ? `${countdown}s` : '获取验证码'}
        </Button>
      </div>
    </Form.Item>
  );

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
                aria-selected={t.enabled && activeTab === t.key}
                disabled={!t.enabled}
                title={t.reason || undefined}
                className={`login-tab${activeTab === t.key ? ' is-active' : ''}${t.enabled ? '' : ' is-disabled'}`}
                onClick={() => {
                  if (!t.enabled) return;
                  // 「账号登录」tab 与注册态共用同一张表单；点它 = 回到登录
                  if (t.key === 'sms') switchMode('sms');
                  else if (t.key === 'qr') switchMode('qr');
                  else setMode('login');
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 扫码登录: 表单整块换成二维码面板 —— 两者没有共享字段, 同屏出现只会分心 */}
          {mode === 'qr' && (
            <QrLoginPanel
              onSuccess={(tk, em, role) => {
                login(tk, em, role);
                message.success('登录成功');
                onSuccess();
              }}
            />
          )}

          {mode !== 'qr' && (
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            requiredMark={false}
            className="login-form"
          >
            {/*
             * 昵称 —— 注册时必填 (2026-10-21 修)。
             *
             * 此前这个字段是 `hidden` 的: 用户看不到、也不会填, 提交的
             * `values.name` 恒为 undefined, 而后端 RegisterDto 要求它是字符串
             * —— **注册必然失败**, 报错还是看不懂的英文校验文案。
             *
             * 修法是把字段还给用户而不是把后端改选填: 昵称会出现在作品、
             * 邀请与订单等所有对外位置, 缺省值拼得难看还会撞名。
             */}
            {mode === 'register' && (
              <Form.Item
                name="name"
                label="昵称"
                className="login-field"
                rules={[
                  { required: true, message: '请输入昵称', whitespace: true },
                  { max: 20, message: '昵称最多 20 个字符' },
                ]}
              >
                <Input prefix={<User size={15} />} placeholder="展示名称" maxLength={20} />
              </Form.Item>
            )}

            {mode !== 'sms' && (
              <Form.Item
                name="email"
                label="邮箱"
                className="login-field"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '邮箱格式不正确' },
                ]}
              >
                <Input
                  ref={emailRef}
                  prefix={<Mail size={15} />}
                  placeholder="账号（邮箱）"
                  autoComplete="username"
                />
              </Form.Item>
            )}

            {mode === 'sms' && (
              <Form.Item
                name="phone"
                label="手机号"
                className="login-field"
                rules={[
                  { required: true, message: '请输入手机号' },
                  { pattern: /^(\+?86[\s-]?)?1[3-9]\d{9}$/, message: '手机号格式不正确' },
                ]}
              >
                <Input
                  prefix={<Smartphone size={15} />}
                  placeholder="已绑定的手机号"
                  maxLength={14}
                  inputMode="tel"
                  autoComplete="tel"
                />
              </Form.Item>
            )}

            {mode !== 'sms' && (
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
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </Form.Item>
            )}

            {/* 注册时的可选手机号 —— 填了才出现验证码（后端强校验归属才能绑定） */}
            {mode === 'register' && (
              <Form.Item
                name="phone"
                label="手机号（选填）"
                className="login-field"
                rules={[{ pattern: /^(\+?86[\s-]?)?1[3-9]\d{9}$/, message: '手机号格式不正确' }]}
              >
                <Input
                  prefix={<Smartphone size={15} />}
                  placeholder="选填，用于短信登录"
                  maxLength={14}
                  inputMode="tel"
                  autoComplete="tel"
                />
              </Form.Item>
            )}

            {mode === 'sms' && codeField('login')}
            {needPhoneCode && codeField('verify')}

            {mode === 'register' && (
              <Form.Item
                name="agreed"
                valuePropName="checked"
                className="login-field login-agree-field"
                rules={[
                  {
                    validator: (_rule, value) =>
                      value
                        ? Promise.resolve()
                        : Promise.reject(new Error('请先阅读并同意用户协议与隐私政策')),
                  },
                ]}
              >
                <Checkbox>
                  我已阅读并同意<a href="/legal/user-agreement.html">用户协议</a>与
                  <a href="/legal/privacy-policy.html">个人信息保护政策</a>
                </Checkbox>
              </Form.Item>
            )}

            {/* 参考站 .auth-submit: 340x48 / linear-gradient(90deg,#8064f6,#5546d8) / 14px 600 / radius 8 */}
            <Button type="primary" htmlType="submit" block className="login-submit" loading={submitting}>
              {mode === 'login' ? '登录' : mode === 'sms' ? '登录' : '注册并登录'}
            </Button>
          </Form>
          )}

          {mode === 'login' && (
            <div className="login-links">
              <a
                onClick={() => {
                  /*
                   * 弹窗宿主里必须先关闭弹窗再跳转：LoginModal 渲染在路由之外，
                   * 只 navigate 的话找回页已经在下面加载了，但登录弹窗仍盖着，
                   * 用户看到的是「点了没反应」。
                   */
                  onCancel?.();
                  navigate('/forgot-password');
                }}
              >
                忘记密码？
              </a>
            </div>
          )}

          {/* 通用 OAuth 登录：只有后端 /auth/oauth/providers 返回已启用项才渲染 */}
          {oauthProviders.length > 0 && (
            <div className="login-oauth">
              <span className="login-oauth-divider">或</span>
              {oauthProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className="login-oauth-btn"
                  onClick={() => {
                    const returnTo = window.location.pathname + window.location.search;
                    window.location.assign(oauthAuthorizeUrl(provider.id, returnTo));
                  }}
                >
                  使用 {provider.name} 登录
                </button>
              ))}
            </div>
          )}

          {/* 参考站 .auth-agreement: 12px/400 #86909C, 内嵌协议链接 */}
          <p className="login-agreement">
            登录即代表我已同意
            <a href="/legal/user-agreement.html">用户协议</a>
            <a href="/legal/privacy-policy.html">个人信息保护政策</a>
            <a href="/legal/account-rules.html">账号规则</a>
          </p>

          {/* 注册入口: 参考站无 (走短信/扫码), 本项目邮箱注册体系需要 → 保留文字链接 */}
          <div className="login-switch">
            {mode === 'register' ? (
              <span>
                已有账号？<a onClick={() => switchMode('login')}>去登录</a>
              </span>
            ) : (
              <span>
                还没有账号？<a onClick={() => switchMode('register')}>立即注册</a>
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
