
import type { DeletionPreview } from '../../types/api';
import { DELETE_CONFIRM_WORD } from './constants';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Alert,
  AlertDescription,
  AlertTitle,
  Input,
} from '../../ui';

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
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="gap-4 p-6 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>确认注销账号</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Alert className="border-warn-border bg-warn-soft text-warn-text">
            <AlertTitle>此操作不可撤销</AlertTitle>
            <AlertDescription>
              {previewLoading
                ? '正在统计影响面…'
                : preview
                  ? `将清除 ${preview.projects} 个项目、${preview.tasks} 个作品、${preview.assets} 个素材、${preview.notifications} 条消息；${preview.orders} 笔订单将匿名化保留。`
                  : '未能获取影响面预览，但不影响注销流程。'}
            </AlertDescription>
          </Alert>
          {hasPassword ? (
            <Input
              type="password"
              placeholder="当前密码"
              value={deletePassword}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="current-password"
            />
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">当前账号未设置密码，将凭当前登录会话确认注销。</p>
          )}
          <Input
            placeholder={`请输入确认词：${DELETE_CONFIRM_WORD}`}
            value={deleteConfirm}
            onChange={(e) => onConfirmChange(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={
              deleting || deleteConfirm !== DELETE_CONFIRM_WORD || (hasPassword && !deletePassword)
            }
            onClick={onOk}
          >
            确认注销
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
