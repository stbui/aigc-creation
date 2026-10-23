import { useState } from 'react';
import { Form, Input, Button, App } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { authApi } from '../lib/api';

/**
 * 重置密码 —— 邮件里的链接落地页。
 *
 * 令牌从 query 里取（后端生成的是 base64url，URL 安全）。
 * 缺失令牌时不发请求，直接给出可操作的回退（重新申请），
 * 而不是让用户填完两次密码才收到一个「链接无效」。
 */
export function ResetPasswordPage() {
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onFinish = async (values: { password: string }) => {
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, values.password);
      setDone(true);
    } catch (e) {
      message.error((e as Error).message || '重置失败，请重新申请');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="login-page">
        <div className="auth-plain-card">
          <h1>链接无效</h1>
          <p className="auth-plain-desc">
            重置链接缺少必要参数，可能复制时被截断。请重新申请一封重置邮件。
          </p>
          <div className="auth-plain-actions">
            <Link to="/forgot-password">重新申请重置链接</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="auth-plain-card">
        {done ? (
          <>
            <h1>密码已重置</h1>
            <p className="auth-plain-desc">
              新密码已生效，此前登录的其它设备需要重新登录。请使用新密码登录。
            </p>
            <div className="auth-plain-result">
              <ShieldCheck size={18} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <span>为安全起见，本次重置已使该账号此前的全部登录会话失效。</span>
            </div>
            <div className="auth-plain-actions">
              <Link to="/login">去登录</Link>
            </div>
          </>
        ) : (
          <>
            <h1>设置新密码</h1>
            <p className="auth-plain-desc">请设置至少 6 位的新密码。提交后旧密码立即失效。</p>
            <Form layout="vertical" onFinish={onFinish} requiredMark={false} className="login-form">
              <Form.Item
                name="password"
                label="新密码"
                className="login-field"
                rules={[
                  { required: true, message: '请输入新密码' },
                  { min: 6, message: '密码至少 6 位' },
                ]}
              >
                <Input.Password
                  prefix={<Lock size={15} />}
                  placeholder="至少 6 位"
                  autoComplete="new-password"
                  autoFocus
                />
              </Form.Item>
              <Form.Item
                name="confirm"
                label="确认新密码"
                className="login-field"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请再次输入新密码' },
                  ({ getFieldValue }) => ({
                    validator(_rule, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('两次输入的密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<Lock size={15} />}
                  placeholder="再次输入"
                  autoComplete="new-password"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                className="login-submit"
                loading={submitting}
              >
                重置密码
              </Button>
            </Form>
            <div className="auth-plain-actions">
              <Link to="/forgot-password">重新申请重置链接</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
