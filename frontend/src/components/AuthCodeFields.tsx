import { ShieldCheck } from 'lucide-react';
import { Button, FormControl, FormField, FormItem, FormLabel, FormMessage, IconInput } from '../ui';
import type { SmsPurpose } from '../types/api';

/**
 * 短信验证码输入框 + 获取按钮。
 *
 * 登录验证手机号与注册验证手机号共用同一段 UI，区别只在 `purpose`
 * （后端据此选模板）。倒计时与发送状态由卡片持有，这里只渲染。
 */
export function SmsCodeField({
  purpose,
  countdown,
  sending,
  onSend,
}: {
  purpose: SmsPurpose;
  countdown: number;
  sending: boolean;
  onSend: (purpose: SmsPurpose) => void;
}) {
  return (
    <FormField
      name="smsCode"
      rules={{ required: '请输入验证码' }}
      render={({ field }) => (
        <FormItem className="login-field">
          <FormLabel>验证码</FormLabel>
          <div className="login-code-row">
            <FormControl>
              <IconInput
                {...field}
                icon={<ShieldCheck size={15} />}
                placeholder="6 位验证码"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </FormControl>
            <Button
              type="button"
              className="login-code-btn"
              onClick={() => onSend(purpose)}
              disabled={countdown > 0 || sending}
            >
              <span className="state-spinner is-small" aria-hidden />
              {countdown > 0 ? `${countdown}s` : '获取验证码'}
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * 注册邮箱验证码输入框。
 *
 * 与短信验证码完全独立：各自的倒计时与发送状态互不影响，
 * 邮箱为空时按钮直接禁用（没有收件地址点了也只会报错）。
 */
export function EmailCodeField({
  countdown,
  sending,
  disabled,
  onSend,
}: {
  countdown: number;
  sending: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <FormField
      name="emailCode"
      rules={{ required: '请输入邮箱验证码' }}
      render={({ field }) => (
        <FormItem className="login-field">
          <FormLabel>邮箱验证码</FormLabel>
          <div className="login-code-row">
            <FormControl>
              <IconInput
                {...field}
                icon={<ShieldCheck size={15} />}
                placeholder="6 位验证码"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </FormControl>
            <Button
              type="button"
              className="login-code-btn"
              onClick={onSend}
              disabled={countdown > 0 || disabled || sending}
            >
              <span className="state-spinner is-small" aria-hidden />
              {countdown > 0 ? `${countdown}s` : '获取验证码'}
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
