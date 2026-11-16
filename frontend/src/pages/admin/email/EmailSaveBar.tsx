import { ActionButton, SaveBar } from './components';

/**
 * 底部保存条。
 *
 * 只在非「邮件模板」分区出现：模板分区有自己逐条的保存动作，两条保存入口并存
 * 会让人分不清「保存配置」到底保存了什么。禁用条件同时覆盖无权限、无改动与
 * 正在保存三种情况，避免重复提交。
 */
export function EmailSaveBar({
  dirtyCount,
  saving,
  writable,
  onDiscard,
  onSave,
}: {
  dirtyCount: number;
  saving: boolean;
  writable: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <SaveBar>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[13px] font-medium text-foreground">
          {dirtyCount > 0 ? `有 ${dirtyCount} 项修改未保存` : '所有配置均已保存'}
        </p>
        <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
          {dirtyCount > 0
            ? '保存后仅影响后续邮件；正在发送的邮件不会变更。'
            : '敏感配置仅显示保存状态，不会在页面回显明文。'}
        </p>
      </div>
      <ActionButton
        variant="outline"
        size="sm"
        disabled={!writable || dirtyCount === 0 || saving}
        onClick={onDiscard}
      >
        放弃修改
      </ActionButton>
      <ActionButton
        variant="default"
        size="sm"
        disabled={!writable || dirtyCount === 0 || saving}
        onClick={onSave}
      >
        {saving ? '保存中…' : '保存配置'}
      </ActionButton>
    </SaveBar>
  );
}
