import { useRef } from 'react';
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
  onTest: (draft: ModelDraft) => Promise<void>;
  onClose: () => void;
  onSubmit: (draft: ModelDraft, intent: 'save' | 'test') => void;
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
  const intentRef = useRef<'save' | 'test'>('save');
  const submitWithIntent = (draft: ModelDraft) => {
    const intent = intentRef.current;
    intentRef.current = 'save';
    onSubmit(draft, intent);
  };

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={editing ? `编辑商品 · ${editing.modelKey}` : '新建商品'}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton
            type="submit"
            form={CHANNEL_MODEL_FORM_ID}
            variant="secondary"
            size="sm"
            disabled={saving || testing || !writable}
            onClick={() => {
              intentRef.current = 'test';
            }}
          >
            {saving ? '保存中…' : testing ? '测试中…' : '保存并测试'}
          </ActionButton>
          <ActionButton
            type="submit"
            form={CHANNEL_MODEL_FORM_ID}
            variant="default"
            size="sm"
            disabled={saving || testing || !writable}
            onClick={() => {
              intentRef.current = 'save';
            }}
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
        onSubmit={submitWithIntent}
        onInvalid={() => {
          intentRef.current = 'save';
        }}
        previousProviderModelKey={previousProviderModelKey}
      />
    </ModalDialog>
  );
}
