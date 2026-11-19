import '../styles/auth.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Form, FormItem, Input, useApp, useForm, useWatch } from '../ui';
import { Link } from 'react-router-dom';
import { ShieldCheck, X } from 'lucide-react';
import { authApi, oauthAuthorizeUrl, type OAuthProviderInfo } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QrLoginPanel } from './QrLoginPanel';
import { AuthFormFields } from './AuthFormFields';
import { LoginGiftArt } from './LoginGiftArt';
import type { SmsPurpose } from '../types/api';

interface AuthForm {
  email: string;
  password: string;
  emailCode?: string;
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
  const { message } = useApp();
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [form] = useForm<AuthForm>();
  const emailRef = useRef<HTMLInputElement>(null);

  // 短信与邮箱验证码各自使用独立状态，避免两个倒计时/loading 互相串台
  const [sendingSms, setSendingSms] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);

  // 注册模式下手机号是选填的；只有填了才显示验证码输入框
  const phoneValue = useWatch('phone', form);
  const emailValue = useWatch('email', form);
  const needPhoneCode = mode === 'register' && Boolean(phoneValue);

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

  // 弹窗打开时把焦点落到账号输入框 (旧版 UI 库 Modal 默认会聚焦第一个可聚焦元素 = 激活 tab),
  // 用户可直接敲键盘; 关闭时归还焦点由 Modal 处理。
  useEffect(() => {
    const t = window.setTimeout(() => emailRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  // 两个验证码倒计时互相独立，归零即停
  useEffect(() => {
    if (smsCountdown <= 0) return;
    const t = window.setTimeout(() => setSmsCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [smsCountdown]);

  useEffect(() => {
    if (emailCountdown <= 0) return;
    const t = window.setTimeout(() => setEmailCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [emailCountdown]);

  /**
   * 发送短信验证码。
   *
   * `delivered=false` 表示后端走的是控制台通道（没配短信服务商）：
   * 必须如实告诉开发者「验证码在 logs/outbox/」，而不是假装发送成功，
   * 否则本地联调会陷入「为什么手机收不到」的死循环。
   */
  const handleSendSms = useCallback(
    async (purpose: SmsPurpose) => {
      const phone = String(form.getFieldValue('phone') ?? '');
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
        setSmsCountdown(SMS_COUNTDOWN);
      } catch (e) {
        message.error((e as Error).message || '验证码发送失败');
      } finally {
        setSendingSms(false);
      }
    },
    [form, message],
  );

  /**
   * 发送注册邮箱验证码。后端对已注册邮箱也恒定返回 `sent=true`，
   * 因此不能文案承诺「已发送」；`delivered=false` 只提示去控制台通道排查。
   */
  const handleSendEmail = useCallback(async () => {
    const email = String(form.getFieldValue('email') ?? '').trim();
    if (!email) {
      message.error('请先填写邮箱');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      message.error('邮箱格式不正确');
      return;
    }
    setSendingEmail(true);
    try {
      const res = await authApi.sendEmail(email);
      if (res.delivered) {
        message.success('验证码已发送，请查收邮件');
      } else {
        message.info('验证码请求已提交；开发环境请查看后端 logs/outbox/email-*.log');
      }
      setEmailCountdown(SMS_COUNTDOWN);
    } catch (e) {
      message.error((e as Error).message || '验证码发送失败');
    } finally {
      setSendingEmail(false);
    }
  }, [form, message]);

  const onFinish = async (values: AuthForm) => {
    setSubmitting(true);
    try {
      if (mode === 'sms') {
        const res = await authApi.smsLogin({ phone: values.phone!, code: values.smsCode! });
        // 短信登录没有邮箱输入，用户身份以服务端返回为准
        login(
          res.accessToken,
          res.user?.email ?? values.phone!,
          res.user?.role,
          res.user?.mustChangePassword,
        );
        message.success('登录成功');
        onSuccess();
        return;
      }

      if (mode === 'login') {
        const res = await authApi.login({ email: values.email, password: values.password });
        login(
          res.accessToken,
          values.email,
          res.user?.role,
          res.user?.mustChangePassword,
        );
        message.success('登录成功');
        onSuccess();
        return;
      }

      // 注册：手机号选填，填了就必须带验证码（后端强校验归属）
      const res = await authApi.register({
        email: values.email,
        password: values.password,
        name: values.name,
        emailCode: values.emailCode!,
        ...(values.phone ? { phone: values.phone, smsCode: values.smsCode } : {}),
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
    setSmsCountdown(0);
    setEmailCountdown(0);
    form.resetFields(['password', 'emailCode', 'name', 'phone', 'smsCode', 'agreed']);
  };

  const activeTab = mode === 'qr' ? 'qr' : mode === 'sms' ? 'sms' : 'account';

  /** 短信验证码输入框 + 获取按钮。登录与注册验证手机号共用同一段 UI */
  const codeField = (purpose: SmsPurpose) => (
    <FormItem
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
          disabled={smsCountdown > 0}
        >
          {smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码'}
        </Button>
      </div>
    </FormItem>
  );

  /** 注册邮箱验证码输入框；与短信验证码完全独立 */
  const emailCodeField = (
    <FormItem
      name="emailCode"
      label="邮箱验证码"
      className="login-field"
      rules={[{ required: true, message: '请输入邮箱验证码' }]}
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
          onClick={() => void handleSendEmail()}
          loading={sendingEmail}
          disabled={emailCountdown > 0 || !emailValue}
        >
          {emailCountdown > 0 ? `${emailCountdown}s` : '获取验证码'}
        </Button>
      </div>
    </FormItem>
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
            <AuthFormFields
              mode={mode}
              emailRef={emailRef}
              emailCodeField={emailCodeField}
              codeField={codeField}
              needPhoneCode={needPhoneCode}
              submitting={submitting}
            />
          </Form>
          )}

          {mode === 'login' && (
            <div className="login-links">
              {/*
                弹窗宿主里必须先关闭弹窗再跳转：LoginModal 渲染在路由之外，
                只跳转的话找回页已经在下面加载了，但登录弹窗仍盖着，
                用户看到的是「点了没反应」。
              */}
              <Link to="/forgot-password" onClick={onCancel}>
                忘记密码？
              </Link>
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

          {/* 注册入口: 参考站无 (走短信/扫码), 本项目邮箱注册体系需要 → 保留文字链接 */}
          <div className="login-switch">
            {mode === 'register' ? (
              <span>
                已有账号？
                <button type="button" className="login-switch-action" onClick={() => switchMode('login')}>
                  去登录
                </button>
              </span>
            ) : (
              <span>
                还没有账号？
                <button
                  type="button"
                  className="login-switch-action"
                  onClick={() => switchMode('register')}
                >
                  立即注册
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
