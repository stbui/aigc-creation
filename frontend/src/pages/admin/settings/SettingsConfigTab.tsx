import {
  ActionButton,
  EmptyState,
  Panel,
  SaveBar,
  TabsContent,
  ToneBadge,
} from './components';
import { CONFIG_TAB_META } from './constants';
import { SettingItemRow } from './SettingItemRow';
import type { SettingItem, SettingsConfigTabKey } from './types';
import { groupSummary } from './utils';
import type { SettingsDraft } from './useSettingsDraft';

/**
 * 一个配置页签：左侧配置项清单 + 保存条，右侧「生效与影响」与待保存变更摘要。
 *
 * 三个页签共用同一份草稿模型；角标的「N 项待保存」按各自 key 前缀统计，
 * 保存条与右侧摘要仍统计全量变更（跨页签修改统一保存）。
 */
export function SettingsConfigTab({
  tabKey,
  model,
  editable,
}: {
  tabKey: SettingsConfigTabKey;
  model: SettingsDraft;
  editable: boolean;
}) {
  const meta = CONFIG_TAB_META[tabKey];
  const group = model.visibleGroups.find((candidate) => candidate.key === tabKey);
  const tabDirty = model.changedKeys.filter((item) => item.startsWith(`${tabKey}.`)).length;
  const tabReadOnly =
    group !== undefined &&
    group.items.length > 0 &&
    group.items.every((item) => item.readOnly);

  return (
    <TabsContent value={tabKey} className="min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        <div className="min-w-0">
          <Panel
            className="mb-0"
            title={meta.title}
            note={group ? groupSummary(group) : meta.note}
            extra={
              <ToneBadge
                tone={tabDirty > 0 ? 'warn' : tabReadOnly ? 'neutral' : 'success'}
              >
                {tabDirty > 0 ? `${tabDirty} 项待保存` : tabReadOnly ? '只读' : '已保存'}
              </ToneBadge>
            }
          >
            {!group || group.items.length === 0 ? (
              <EmptyState title="该分组暂无配置项" />
            ) : (
              <div className="flex flex-col">
                {group.items.map((item: SettingItem) => (
                  <SettingItemRow
                    key={item.key}
                    item={item}
                    value={item.key in model.draft ? model.draft[item.key] : item.value}
                    isDraft={item.key in model.draft}
                    isClearing={model.clears.has(item.key)}
                    editable={editable}
                    onChange={(value) => model.setValue(item.key, value)}
                    onRevert={() => model.revert(item.key)}
                    onClear={() => model.requestClear(item.key)}
                  />
                ))}
              </div>
            )}
          </Panel>

          {editable && model.dirtyCount > 0 && (
            <SaveBar className="mt-4">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                共 {model.dirtyCount} 项变更待保存
                {model.clears.size > 0 ? `，其中 ${model.clears.size} 项恢复默认` : ''}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <ActionButton
                  variant="secondary"
                  disabled={model.busy}
                  onClick={model.discardChanges}
                >
                  放弃变更
                </ActionButton>
                <ActionButton disabled={model.busy} onClick={model.openConfirm}>
                  保存变更
                </ActionButton>
              </div>
            </SaveBar>
          )}
        </div>

        <aside className="sticky top-4 flex flex-col gap-4" aria-label={`${meta.title}说明`}>
          <Panel title="生效与影响" note={meta.note} className="mb-0">
            <ul className="flex flex-col gap-2 text-[12px] leading-5 text-muted-foreground">
              {meta.effects.map((effect) => (
                <li key={effect} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-brand" />
                  <span>{effect}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel
            className="mb-0"
            title="待保存变更"
            note={model.dirtyCount > 0 ? `共 ${model.dirtyCount} 项` : '当前无变更'}
          >
            {model.dirtyCount > 0 ? (
              <ul className="flex flex-col gap-2.5">
                {model.changeSummary.slice(0, 5).map((change) => (
                  <li key={change.key} className="min-w-0 text-[12px] leading-5">
                    <p className="truncate font-medium text-foreground" title={change.label}>
                      {change.label}
                    </p>
                    <p className="truncate text-muted-foreground" title={`${change.from} → ${change.to}`}>
                      {change.from} → <span className="font-medium text-warn-text">{change.to}</span>
                    </p>
                  </li>
                ))}
                {model.changeSummary.length > 5 && (
                  <li className="text-[12px] text-muted-foreground">
                    另有 {model.changeSummary.length - 5} 项，请在保存确认中查看。
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-[12px] leading-5 text-muted-foreground">
                {editable
                  ? '修改配置后，这里会列出保存前后的差异。'
                  : '当前账号只可查看配置，不能保存修改。'}
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </TabsContent>
  );
}
