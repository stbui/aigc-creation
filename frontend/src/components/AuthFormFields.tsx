import type { ReactNode, RefObject } from 'react';
import { Lock, Mail, Smartphone, User } from 'lucide-react';
import { Button, FormControl, FormField, FormItem, FormLabel, FormMessage, IconInput } from '../ui';
import type { SmsPurpose } from '../types/api';

/**
 * 登录卡的账号字段区（昵称 / 邮箱 / 密码 / 手机号 / 各类验证码 + 提交按钮）。
 *
 * 2026-11-15 从 `AuthCard` 抽出：那个组件同时管四种模式的状态机、短信倒计时、
 * OAuth 跳转、协议勾选与全部字段 JSX。这里只声明「某个模式下该出现哪些字段」，
 * 校验规则与提交仍在主组件的 Form 上（`type="submit"` 依赖父级 Form）。
 *
 * 字段的显隐口径（勿随意合并）：
 *   - 昵称：仅注册必填 —— 昵称会出现在作品 / 邀请 / 订单等所有对外位置；
 *   - 邮箱：短信模式不显示（手机号即账号）；
 *   - 密码：短信模式不显示（无密码登录）；
 *   - 手机号：注册时选填，填了才出现验证码（后端强校验归属才能绑定）。
 */
interface Props {
  mode: 'login' | 'register' | 'sms' | 'qr';
  emailRef: RefObject<HTMLInputElement | null>;
  /** 注册邮箱验证码字段（由主组件按倒计时状态构造） */
  emailCodeField: ReactNode;
  /** 短信验证码字段工厂：`login` 用于短信登录，`verify` 用于注册绑手机 */
  codeField: (purpose: SmsPurpose) => ReactNode;
  needPhoneCode: boolean;
  submitting: boolean;
}

export function AuthFormFields({
  mode,
  emailRef,
  emailCodeField,
  codeField,
  needPhoneCode,
  submitting,
}: Props) {
  return (
    <>
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
        <FormField
          name="name"
          rules={{
            validate: (value: unknown) => (String(value ?? '').trim() ? true : '请输入昵称'),
            maxLength: { value: 20, message: '昵称最多 20 个字符' },
          }}
          render={({ field }) => (
            <FormItem className="login-field">
              <FormLabel>昵称</FormLabel>
              <FormControl>
                <IconInput
                  {...field}
                  icon={<User size={15} />}
                  placeholder="展示名称"
                  maxLength={20}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {mode !== 'sms' && (
        <FormField
          name="email"
          rules={{
            required: '请输入邮箱',
            pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: '邮箱格式不正确' },
          }}
          render={({ field }) => (
            <FormItem className="login-field">
              <FormLabel>邮箱</FormLabel>
              <FormControl>
                <IconInput
                  {...field}
                  ref={emailRef}
                  icon={<Mail size={15} />}
                  placeholder="账号（邮箱）"
                  autoComplete="username"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {mode === 'register' && emailCodeField}

      {mode === 'sms' && (
        <FormField
          name="phone"
          rules={{
            required: '请输入手机号',
            pattern: {
              value: /^(\+?86[\s-]?)?1[3-9]\d{9}$/,
              message: '手机号格式不正确',
            },
          }}
          render={({ field }) => (
            <FormItem className="login-field">
              <FormLabel>手机号</FormLabel>
              <FormControl>
                <IconInput
                  {...field}
                  icon={<Smartphone size={15} />}
                  placeholder="已绑定的手机号"
                  maxLength={14}
                  inputMode="tel"
                  autoComplete="tel"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {mode !== 'sms' && (
        <FormField
          name="password"
          rules={{
            required: '请输入密码',
            minLength: { value: 6, message: '密码至少 6 位' },
          }}
          render={({ field }) => (
            <FormItem className="login-field">
              <FormLabel>密码</FormLabel>
              <FormControl>
                <IconInput
                  {...field}
                  icon={<Lock size={15} />}
                  type="password"
                  placeholder="请输入密码"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {/* 注册时的可选手机号 —— 填了才出现验证码（后端强校验归属才能绑定） */}
      {mode === 'register' && (
        <FormField
          name="phone"
          rules={{
            pattern: {
              value: /^(\+?86[\s-]?)?1[3-9]\d{9}$/,
              message: '手机号格式不正确',
            },
          }}
          render={({ field }) => (
            <FormItem className="login-field">
              <FormLabel>手机号（选填）</FormLabel>
              <FormControl>
                <IconInput
                  {...field}
                  icon={<Smartphone size={15} />}
                  placeholder="选填，用于短信登录"
                  maxLength={14}
                  inputMode="tel"
                  autoComplete="tel"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {mode === 'sms' && codeField('login')}
      {needPhoneCode && codeField('verify')}

      {/* 参考站 .auth-submit: 340x48 / linear-gradient(90deg,#8064f6,#5546d8) / 14px 600 / radius 8 */}
      <Button disabled={submitting} variant="default" type="submit" className="w-full login-submit">
        <span className="state-spinner is-small" aria-hidden />
        {mode === 'login' ? '登录' : mode === 'sms' ? '登录' : '注册并登录'}
      </Button>
    </>
  );
}
