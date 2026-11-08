
import type { DeletionPreview } from '../../types/api';
import { DELETE_CONFIRM_WORD } from './constants';
import { Alert, Input, Modal } from '../../ui';

/**
 * 注销账号弹窗。
 *
 * 双重确认: 影响面预览先把「会失去什么」摊开, 再要求当前密码 + 逐字输入确认词。
 * 预览请求与校验都在页面侧完成, 这里只负责把用户输入上抛 ——
 * 弹窗每次打开都会重新拉预览, 自持状态会展示上一次账号的影响面。
 */
export function AccountDeleteModal({
  open,
  deleting,
  hasPassword,
  preview,
  previewLoading,
  deletePassword,
  deleteConfirm,
  onPasswordChange,
  onConfirmChange,
  onOk,
  onCancel,
}: {
  open: boolean;
  deleting: boolean;
  hasPassword: boolean;
  preview: DeletionPreview | null;
  previewLoading: boolean;
  deletePassword: string;
  deleteConfirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title="确认注销账号"
      okText="确认注销"
      okButtonProps={{
        danger: true,
        loading: deleting,
        disabled: deleteConfirm !== DELETE_CONFIRM_WORD || (hasPassword && !deletePassword),
      }}
      cancelText="取消"
      onOk={onOk}
      onCancel={onCancel}
      destroyOnHidden
    >
      <div className="account-delete-body">
        <Alert
          type="warning"
          showIcon
          title="此操作不可撤销"
          description={
            previewLoading
              ? '正在统计影响面…'
              : preview
                ? `将清除 ${preview.projects} 个项目、${preview.tasks} 个作品、${preview.assets} 个素材、${preview.notifications} 条消息；${preview.orders} 笔订单将匿名化保留。`
                : '未能获取影响面预览，但不影响注销流程。'
          }
        />
        {hasPassword ? (
          <Input.Password
            placeholder="当前密码"
            value={deletePassword}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="current-password"
          />
        ) : (
          <p className="account-hint">当前账号未设置密码，将凭当前登录会话确认注销。</p>
        )}
        <Input
          placeholder={`请输入确认词：${DELETE_CONFIRM_WORD}`}
          value={deleteConfirm}
          onChange={(e) => onConfirmChange(e.target.value)}
        />
      </div>
    </Modal>
  );
}
