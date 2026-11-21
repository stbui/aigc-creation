
import { MIN_PASSWORD_LENGTH } from './constants';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../../ui';

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
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="gap-4 p-6 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{hasPassword ? '修改密码' : '设置登录密码'}</DialogTitle>
          <DialogDescription>
            {hasPassword
              ? '修改成功后，该账号在所有设备上的登录状态都会失效，需要重新登录。'
              : '当前账号通过第三方登录创建，尚未设置密码。设置后可使用邮箱和密码登录。'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          {hasPassword && (
            <Input
              type="password"
              placeholder="当前密码"
              value={oldPassword}
              onChange={(e) => onOldPasswordChange(e.target.value)}
              autoComplete="current-password"
            />
          )}
          <Input
            type="password"
            placeholder={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
            value={newPassword}
            onChange={(e) => onNewPasswordChange(e.target.value)}
            autoComplete="new-password"
          />
          <Input
            type="password"
            placeholder="再次输入新密码"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={(hasPassword && !oldPassword) || !newPassword || !confirmPassword || changing}
            onClick={onOk}
          >
            {hasPassword ? '确认修改' : '设置密码'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
