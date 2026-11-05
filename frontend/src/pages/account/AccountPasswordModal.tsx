
import { MIN_PASSWORD_LENGTH } from './constants';
import { Input, Modal } from '../../ui';

/**
 * 修改密码弹窗。
 *
 * 输入由页面持有 (打开时清空、提交后按结果决定是否关闭),
 * 这里只负责展示与把变更上抛 —— 组件内自持状态会在弹窗频繁开关时
 * 留下上一次的已失效密码。
 */
export function AccountPasswordModal({
  open,
  changing,
  hasPassword,
  oldPassword,
  newPassword,
  confirmPassword,
  onOldPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onOk,
  onCancel,
}: {
  open: boolean;
  changing: boolean;
  /** false = 纯 OAuth 账号首次设置密码，不需要也不展示旧密码 */
  hasPassword: boolean;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
  onOldPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      className="account-modal"
      open={open}
      title={hasPassword ? '修改密码' : '设置登录密码'}
      okText={hasPassword ? '确认修改' : '设置密码'}
      cancelText="取消"
      confirmLoading={changing}
      okButtonProps={{ disabled: (hasPassword && !oldPassword) || !newPassword || !confirmPassword }}
      onOk={onOk}
      onCancel={onCancel}
      destroyOnHidden
    >
      <p className="account-desc">
        {hasPassword
          ? '修改成功后，该账号在所有设备上的登录状态都会失效，需要重新登录。'
          : '当前账号通过第三方登录创建，尚未设置密码。设置后可使用邮箱和密码登录。'}
      </p>
      <div className="account-form">
        {hasPassword && (
          <Input.Password
            placeholder="当前密码"
            value={oldPassword}
            onChange={(e) => onOldPasswordChange(e.target.value)}
            autoComplete="current-password"
          />
        )}
        <Input.Password
          placeholder={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
          value={newPassword}
          onChange={(e) => onNewPasswordChange(e.target.value)}
          autoComplete="new-password"
        />
        <Input.Password
          placeholder="再次输入新密码"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          autoComplete="new-password"
        />
      </div>
    </Modal>
  );
}
