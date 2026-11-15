import type { ComponentType, ReactNode } from 'react';
import { useDiscardConfirm } from '../../hooks/useUnsavedGuard';
import { ActionButton } from './forms';
import { Drawer, type DrawerSize } from './Drawer';
import { Notice } from './feedback';

export function FormDrawer({
  open,
  onClose,
  title,
  description,
  size = 'md',
  busy = false,
  dirty = false,
  formError,
  submitLabel = '保存',
  submitIcon,
  submitDisabled = false,
  onSubmit,
  cancelLabel = '取消',
  extraFooter,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DrawerSize;
  busy?: boolean;
  dirty?: boolean;
  formError?: string | null;
  submitLabel?: string;
  submitIcon?: ComponentType<{ className?: string }>;
  submitDisabled?: boolean;
  onSubmit?: () => void;
  cancelLabel?: string;
  extraFooter?: ReactNode;
  children: ReactNode;
}) {
  const confirmDiscard = useDiscardConfirm(dirty && !busy, onClose);

  const requestClose = () => {
    if (busy) return;
    confirmDiscard();
  };

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      size={size}
      title={title}
      description={
        dirty ? (
          <>
            <span className="font-medium text-radar-code">有未保存修改</span>
            {description ? <> · {description}</> : null}
          </>
        ) : (
          description
        )
      }
      footer={
        <>
          <ActionButton variant="secondary" onClick={requestClose} disabled={busy}>
            {cancelLabel}
          </ActionButton>
          {extraFooter}
          {onSubmit && (
            <ActionButton
              icon={submitIcon}
              disabled={busy || submitDisabled}
              onClick={onSubmit}
            >
              {busy ? '保存中…' : submitLabel}
            </ActionButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <Notice tone="danger" className="mb-0">
            {formError}
          </Notice>
        )}
        {children}
      </div>
    </Drawer>
  );
}
