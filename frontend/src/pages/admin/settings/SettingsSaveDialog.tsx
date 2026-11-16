import { ActionButton, ModalDialog, Spinner } from './components';
import type { ConfigTabMeta } from './types';
import type { SettingsDraft } from './useSettingsDraft';

/** 统一保存的二次确认：写库前把跨页签的全部变更与各自生效时机摊开给运营看。 */
export function SettingsSaveDialog({
  model,
  activeMeta,
}: {
  model: SettingsDraft;
  activeMeta: ConfigTabMeta | null;
}) {
  return (
    <ModalDialog
      open={model.confirming}
      onOpenChange={(open) => {
        if (!open && !model.busy) model.closeConfirm();
      }}
      title="保存系统设置"
      description="以下变更将写入运行时配置；每项生效时机见变更说明。"
      size="sm"
      footer={
        <>
          <ActionButton variant="outline" disabled={model.busy} onClick={model.closeConfirm}>
            取消
          </ActionButton>
          <ActionButton disabled={model.busy} onClick={() => void model.save()}>
            {model.busy && <Spinner aria-hidden />}
            {model.busy ? '保存中…' : '确认保存'}
          </ActionButton>
        </>
      }
    >
      {activeMeta && (
        <p className="mb-3 text-[12px] leading-5 text-muted-foreground">
          {activeMeta.title}：{activeMeta.note}
        </p>
      )}
      {model.changeSummary.length > 0 && (
        <div className="rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn-text">
          <div className="font-medium">本次变更</div>
          <ul className="mt-2 flex flex-col gap-2">
            {model.changeSummary.map((change) => (
              <li key={change.key}>
                <p className="font-medium">
                  {change.label}：{change.from} → {change.to}
                </p>
                <p className="mt-0.5 opacity-80">{change.effect}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ModalDialog>
  );
}
