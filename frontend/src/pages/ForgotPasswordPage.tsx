import '../styles/auth.css';
import { useState } from 'react';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  useApp,
  useForm,
} from '../ui';
import { Link } from 'react-router-dom';
import { Mail, ShieldCheck } from 'lucide-react';
import { authApi } from '../lib/api';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

/**
 * 找回密码 —— 独立页（无侧栏、无登录卡左栏）。
 *
 * ## 文案必须留有余地
 *
 * 后端对「邮箱不存在」与「已发送」返回**完全相同**的 `{ requested: true }`
 * （防账号枚举）。因此这里的状态文案只能写「如果该邮箱已注册…」，
 * 不能写「邮件已发送」—— 后者会诱使用户反复检查收件箱，
 * 而账号根本不存在。
 */
export function ForgotPasswordPage() {
  useDocumentMeta('找回密码 · 货觉AI', '通过注册邮箱重置货觉AI账号密码。');
  const { message } = useApp();
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<{ email: string }>();

  const onSubmit = async (values: { email: string }) => {
    setSubmitting(true);
    try {
      await authApi.forgotPassword(values.email.trim());
      setSentTo(values.email.trim());
    } catch (e) {
      // 只有网络/服务端异常会走到这里；账号存在性不会
      message.error((e as Error).message || '请求失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="auth-plain-card">
        {sentTo ? (
          <>
            <h1>请查收邮件</h1>
            <p className="auth-plain-desc">
              如果该邮箱已注册，我们已向它发送了一封包含重置链接的邮件，链接 30 分钟内有效。
            </p>
            <div className="auth-plain-result">
              <ShieldCheck size={18} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <span>
                已提交：{sentTo}
                <br />
                没收到？请检查垃圾邮件文件夹，或 30 分钟后重新申请。
              </span>
            </div>
            <div className="auth-plain-actions">
              <Link to="/login">返回登录</Link>
            </div>
          </>
        ) : (
          <>
            <h1>找回密码</h1>
            <p className="auth-plain-desc">
              输入注册时使用的邮箱，我们会发送一封包含重置链接的邮件。
            </p>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                aria-label="找回密码"
                className="login-form"
                noValidate
              >
                <FormField
                  control={form.control}
                  name="email"
                  rules={{
                    required: '请输入邮箱',
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: '邮箱格式不正确',
                    },
                  }}
                  render={({ field }) => (
                    <FormItem className="login-field">
                      <FormLabel>邮箱</FormLabel>
                      <FormControl>
                        <InputGroup>
                          <InputGroupAddon>{<Mail size={15} />}</InputGroupAddon>
                          <InputGroupInput
                            {...field}
                            placeholder="账号（邮箱）"
                            autoComplete="username"
                            autoFocus
                          />
                        </InputGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button disabled={submitting}
                  variant="default"
                  type="submit"
                  className="w-full login-submit"
                >
                  <span className="state-spinner is-small" aria-hidden />
                  发送重置链接
                </Button>
              </form>
            </Form>
            <div className="auth-plain-actions">
              想起来了？<Link to="/login">返回登录</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
