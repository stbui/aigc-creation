import { Copy } from 'lucide-react';
import {
  ActionButton,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  ModalDialog,
} from '~/admin-ui/primitives';
import { useToast } from './hooks';
import { formatDateTime } from './utils';

/**
 * 临时密码只展示一次。
 *
 * 密码放进只读输入框，既避免长字符串挤出弹框，也方便用户直接选中复制。
 */
export function TempPasswordDialog({
  password,
  expiresAt,
  onClose,
}: {
  password: string;
  expiresAt?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success('已复制');
    } catch {
      // 剪贴板不可用时仍可手动选中输入框内容。
    }
  };

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="临时密码已生成"
      description="请立即复制并安全转交给用户，关闭后无法再次查看。"
      width={440}
      footer={<ActionButton onClick={onClose}>我已保存</ActionButton>}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">临时密码</span>
        <InputGroup className="h-10 bg-background">
          <InputGroupInput
            readOnly
            value={password}
            aria-label="临时密码"
            className="font-mono text-sm"
            onFocus={(event) => event.currentTarget.select()}
          />
          <InputGroupAddon align="inline-end" className="pr-1">
            <InputGroupButton variant="secondary" size="sm" onClick={() => void copyPassword()}>
              <Copy />
              复制
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p className="text-xs leading-5 text-muted-foreground">
          用户首次登录后必须先修改密码，改密前只能访问账号资料与改密接口。
          {expiresAt && `临时密码有效期至 ${formatDateTime(expiresAt)}。`}
        </p>
      </div>
    </ModalDialog>
  );
}
