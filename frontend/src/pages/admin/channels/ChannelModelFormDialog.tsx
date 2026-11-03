import { ActionButton, ModalDialog } from '~/admin-ui/primitives';
import { ChannelModelForm } from './ChannelModelForm';
import type { ModelDraft } from './constants';
import type { AdminChannelModelView, ProtocolTestResultView } from '../../../types/model';

interface ChannelModelFormDialogProps {
  open: boolean;
  editing: AdminChannelModelView | null;
  draft: ModelDraft;
  setDraft: (next: ModelDraft) => void;
  protocolOptions: Array<{ value: string; label: string }>;
  testResult: ProtocolTestResultView | null;
  testing: boolean;
  saving: boolean;
  writable: boolean;
  onTest: () => Promise<void>;
  onClose: () => void;
  onSubmit: () => void;
  /** 编辑前的模型级上游键（用于检测仍指向旧上游的档位） */
  previousProviderModelKey?: string;
  /** 一键让这批档位跟随模型默认上游 */
  onFollowModelUpstream?: () => void;
}

/** 模型编辑器弹窗：右侧详情区保持「这条渠道有哪些模型」的稳定视图 */
export function ChannelModelFormDialog({
  open,
  editing,
  draft,
  setDraft,
  protocolOptions,
  testResult,
  testing,
  saving,
  writable,
  onTest,
  onClose,
  onSubmit,
  previousProviderModelKey,
  onFollowModelUpstream,
}: ChannelModelFormDialogProps) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={980}
      title={editing ? `编辑模型 · ${editing.modelKey}` : '新建渠道模型'}
      description="价格按「积分」输入，最多 6 位小数；保存后立即进入路由目录"
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton variant="default" size="sm" disabled={saving || !writable} onClick={onSubmit}>
            {saving ? '保存中…' : '保存模型'}
          </ActionButton>
        </>
      }
    >
      <ChannelModelForm
        draft={draft}
        setDraft={setDraft}
        protocolOptions={protocolOptions}
        testResult={testResult}
        testing={testing}
        onTest={onTest}
        previousProviderModelKey={previousProviderModelKey}
        onFollowModelUpstream={onFollowModelUpstream}
      />
    </ModalDialog>
  );
}
