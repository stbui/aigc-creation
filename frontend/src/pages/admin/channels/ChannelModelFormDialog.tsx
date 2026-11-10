import { ActionButton, ModalDialog } from '~/admin-ui/primitives';
import {
  CHANNEL_MODEL_FORM_ID,
  ChannelModelForm,
} from './ChannelModelForm';
import type { ModelDraft } from './constants';
import type { AdminChannelModelView, ProtocolTestResultView } from '../../../types/model';

interface ChannelModelFormDialogProps {
  open: boolean;
  editing: AdminChannelModelView | null;
  draft: ModelDraft;
  testResult: ProtocolTestResultView | null;
  testing: boolean;
  saving: boolean;
  writable: boolean;
  onTest: () => Promise<void>;
  onClose: () => void;
  onSubmit: (draft: ModelDraft) => void;
  /** 编辑前的模型级上游键（用于检测仍指向旧上游的档位） */
  previousProviderModelKey?: string;
}

/** 模型编辑器弹窗：右侧详情区保持「这条渠道有哪些模型」的稳定视图 */
export function ChannelModelFormDialog({
  open,
  editing,
  draft,
  testResult,
  testing,
  saving,
  writable,
  onTest,
  onClose,
  onSubmit,
  previousProviderModelKey,
}: ChannelModelFormDialogProps) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={980}
      title={editing ? `编辑商品 · ${editing.modelKey}` : '新建商品'}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton
            type="submit"
            form={CHANNEL_MODEL_FORM_ID}
            variant="default"
            size="sm"
            disabled={saving || !writable}
          >
            {saving ? '保存中…' : '保存商品'}
          </ActionButton>
        </>
      }
    >
      <ChannelModelForm
        key={`${editing?.id ?? 'new'}-${draft.modelKey}`}
        draft={draft}
        testResult={testResult}
        testing={testing}
        onTest={onTest}
        onSubmit={onSubmit}
        previousProviderModelKey={previousProviderModelKey}
      />
    </ModalDialog>
  );
}
