import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, App } from 'antd';
import { Image as ImageIcon, Mail, Lock, User } from 'lucide-react';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { DEMO_CREDENTIALS } from '../lib/constants';

interface AuthForm {
  email: string;
  password: string;
  name?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { message } = App.useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<AuthForm>();

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
      login(res.accessToken, values.email);
      message.success(mode === 'login' ? '登录成功' : '注册成功，已自动登录');
      navigate('/workbench', { replace: true });
    } catch (e) {
      message.error((e as Error).message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card-wrap">
        <div className="login-brand">
          <span className="login-logo">
            <ImageIcon size={22} />
          </span>
          <span className="login-brand-name">电商视觉工坊</span>
        </div>
        <p className="login-subtitle">
          {mode === 'login' ? '登录后开始生成商品视觉' : '创建账号，立即试用 AI 生成能力'}
        </p>

        <Card className="login-card">
          <Form
            form={form}
            layout="vertical"
            initialValues={DEMO_CREDENTIALS}
            onFinish={onFinish}
            requiredMark={false}
          >
            {mode === 'register' && (
              <Form.Item name="name" label="昵称（选填）">
                <Input prefix={<User size={15} />} placeholder="展示名称" maxLength={20} />
              </Form.Item>
            )}
            <Form.Item
              name="email"
              label="邮箱"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '邮箱格式不正确' },
              ]}
            >
              <Input
                prefix={<Mail size={15} />}
                placeholder="you@example.com"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
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

            <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
              {mode === 'login' ? '登录' : '注册并登录'}
            </Button>
          </Form>

          {mode === 'login' && (
            <Button type="link" block onClick={fillDemo} className="login-demo-fill" style={{ marginTop: 4 }}>
              填充演示账号
            </Button>
          )}

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
        </Card>
      </div>
    </div>
  );
}
