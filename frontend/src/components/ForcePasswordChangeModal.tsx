import { useState } from 'react';
import { Input, Modal, useApp } from '../ui';
import { meApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/** 与 /me/password 的后端校验保持一致（account.service.ts 的 6 位下限） */
const MIN_PASSWORD_LENGTH = 6;

/**
 * 强制改密弹窗。
 *
 * 后台重置密码后，后端只放行 `/me` 与 `/me/password`，其余请求返回 40303。
 * 这里用不可关闭的弹窗把用户限制在改密流程里；改密成功会让 tokenVersion +1，
 * 当前 token 立即失效，因此紧接着登出并打开登录框，让用户用新密码重新登录。
 */
export function ForcePasswordChangeModal() {
  const { token, mustChangePassword, logout, openLogin } = useAuth();
  const { message } = useApp();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token || !mustChangePassword) return null;

  const canSubmit =
    oldPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    confirmPassword.length > 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await meApi.changePassword(oldPassword, newPassword);
      message.success('密码已修改，请使用新密码重新登录');
      // 改密已使当前 token 失效，先清本地会话再打开登录框。
      logout();
      openLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : '修改密码失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title="请先修改登录密码"
      closable={false}
      maskClosable={false}
      keyboard={false}
      confirmLoading={submitting}
      okText="确认修改"
      okButtonProps={{ disabled: !canSubmit }}
      onOk={() => void submit()}
      onCancel={() => undefined}
      footer={
        <div className="ui-modal-foot">
          <button
            type="button"
            className="ui-btn is-primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting ? '提交中…' : '确认修改'}
          </button>
        </div>
      }
    >
      <p className="account-desc">
        管理员已重置你的登录密码。为保护账号安全，请先用临时密码登录后设置新密码，
        完成前无法使用其他功能。临时密码 24 小时内有效。
      </p>
      <div className="account-form">
        <Input.Password
          placeholder="当前密码（管理员提供的临时密码）"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
        />
        <Input.Password
          placeholder={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Input.Password
          placeholder="再次输入新密码"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && (
        <p className="account-desc" role="alert" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
