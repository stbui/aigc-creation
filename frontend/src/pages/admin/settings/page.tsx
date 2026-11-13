import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  HIDDEN_SETTING_GROUP_KEYS,
  SETTINGS_TABS,
  isSettingsTabKey,
  settingGroupPath,
  type SettingItem,
  type SettingsTabKey,
} from './constants';
import { SettingItemRow } from './SettingItemRow';
import { displayValue, groupSummary } from './utils';
import { useAdmin, useAdminResource, useToast, useUnsavedGuard } from './hooks';

import { adminSettingsApi } from '../../../lib/api';
import { UPLOAD_LIMITS_CHANGED_EVENT } from '../../../lib/api-settings';
import type { AdminSettingValue } from '../../../types/api';
import {
  ActionButton,
  AdminPage,
  AdminTabs,
  EmptyState,
  ListError,
  ModalDialog,
  PageSkeleton,
  Panel,
  SaveBar,
  SkeletonPanel,
  Spinner,
  StaleError,
  TabsContent,
  ToneBadge,
} from '~/admin-ui/primitives';

const CONFIG_TAB_META: Record<
  Exclude<SettingsTabKey, 'security'>,
  { title: string; note: string; effects: string[] }
> = {
  generate: {
    title: '冻结积分退回',
    note: '控制失败或中断任务冻结积分的自动退回。',
    effects: [
      '保存后，账单清扫任务在下一轮检查时读取新开关；清扫间隔为 5 分钟。',
      '关闭时，冻结积分不会自动退回，符合条件的订单保留在待核对队列，由后台人工处理。',
      '恢复默认只删除运行时覆盖，不修改现有订单、任务和积分账本。',
    ],
  },
  upload: {
    title: '图片上传限制',
    note: '约束单张图片的大小、像素总量和可解析格式。',
    effects: [
      '保存后，从下一次上传请求开始使用新限制；已上传图片和进行中的上传不受影响。',
      '网页端按同一组限制预检格式、文件大小与像素总量；后端仍会复核真实文件头和像素数。',
      '恢复默认只删除运行时覆盖，不重写或删除已上传文件。',
    ],
  },
  backup: {
    title: '自动备份周期',
    note: '控制计划备份的到期判断，不改变备份文件的保留份数。',
    effects: [
      '调度器每 10 分钟检查一次；保存后在下一个检查周期按新周期判断是否到期。',
      '是否到期从最近一次成功备份时间起计算；缩短周期后可能在下一次检查立即触发。',
      '修改周期不会补做此前错过的备份，也不会删除已有备份文件。',
    ],
  },
};

function effectForSetting(key: string): string {
  if (key.startsWith('generate.')) return '下一轮账单清扫时生效（最长约 5 分钟）';
  if (key.startsWith('upload.')) return '下一次上传请求生效；已上传图片不受影响';
  if (key.startsWith('backup.')) return '下一次调度检查时生效（最长约 10 分钟）';
  return '保存后由对应业务在下次读取时生效';
}

function SettingsSecurityTab() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
      <Panel title="访问令牌" note="部署环境变量 · 本页不可编辑">
        <p className="text-[13px] leading-6 text-foreground">
          访问令牌有效期由启动环境变量 <code className="rounded bg-muted px-1 py-0.5">JWT_TTL</code>{' '}
          控制。修改后需重启全部后端实例；新签发的令牌使用新有效期，已签发令牌仍按原到期时间失效。
        </p>
      </Panel>
      <Panel title="密码最小长度" note="后端校验规则 · 本页不可编辑">
        <p className="text-[13px] leading-6 text-foreground">
          注册、重置密码和修改密码均要求至少 6 位。调整规则需修改对应后端 DTO
          并重新发布服务，不能通过系统设置在线修改。
        </p>
      </Panel>
    </div>
  );
}

/**
 * 系统设置。
 *
 * 页面只保留四个真实运营页签：运行与生成、上传限制、备份、安全。
 * 邮箱、支付、退款与保留期分别使用独立工作台。页签只能由 AdminShell 的四个
 * 显式路由传入，页面不识别路径参数或查询参数。
 */
export function AdminSettingsPage({ group: activeTab }: { group: SettingsTabKey }) {
  const toast = useToast();
  const { can } = useAdmin();
  const editable = can('setting.write');
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, AdminSettingValue>>({});
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const { data: settings, loading, error, reload } = useAdminResource(() => adminSettingsApi.read());

  const visibleGroups = useMemo(
    () =>
      settings?.groups.filter(
        (group) =>
          isSettingsTabKey(group.key) &&
          group.key !== 'security' &&
          !HIDDEN_SETTING_GROUP_KEYS.has(group.key),
      ) ?? [],
    [settings],
  );

  const changedKeys = useMemo(
    () => [...new Set([...Object.keys(draft), ...clears])],
    [draft, clears],
  );
  const dirtyCount = changedKeys.length;
  useUnsavedGuard(dirtyCount > 0);

  const setValue = (key: string, value: AdminSettingValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setClears((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const revert = (key: string) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setClears((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const requestClear = (key: string) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setClears((current) => new Set(current).add(key));
  };

  const changeSummary = useMemo(() => {
    if (!settings) return [];
    const allItems = settings.groups.flatMap((group) => group.items);
    return changedKeys.map((key) => {
      const item = allItems.find((candidate) => candidate.key === key);
      const currentValue = item?.sensitive
        ? item.overridden
          ? '已配置'
          : '未配置'
        : item
          ? displayValue(item.value, item.type)
          : '—';
      const nextValue = clears.has(key)
        ? item?.sensitive
          ? '已清除'
          : `${item ? displayValue(item.default, item.type) : '—'}（恢复默认）`
        : item?.sensitive
          ? '已更新'
          : displayValue(draft[key], item?.type ?? 'string');
      return {
        key,
        label: item?.label ?? key,
        from: currentValue,
        to: nextValue,
        effect: effectForSetting(key),
      };
    });
  }, [changedKeys, clears, draft, settings]);

  const save = async () => {
    setBusy(true);
    const uploadChanged = changedKeys.some((key) => key.startsWith('upload.'));
    try {
      const result = await adminSettingsApi.update({
        settings: Object.fromEntries(
          Object.entries(draft).filter(([key]) => !clears.has(key)),
        ),
        clears: [...clears],
      });
      setDraft({});
      setClears(new Set());
      await reload();
      if (uploadChanged) window.dispatchEvent(new Event(UPLOAD_LIMITS_CHANGED_EVENT));
      setConfirming(false);
      toast.success(
        result.cleared.length > 0
          ? `已保存 ${result.updated.length} 项、恢复默认 ${result.cleared.length} 项`
          : `已保存 ${result.updated.length} 项配置`,
      );
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !settings) {
    return (
      <PageSkeleton
        title="系统设置"
        description={
          editable
            ? '管理上传边界、冻结积分退回与数据备份。修改统一保存，生效时机以确认提示为准。'
            : '当前账号无 setting.write 权限，仅可查看。'
        }
        body={
          <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
            <SkeletonPanel rows={6} className="mb-0" />
            <div className="flex flex-col gap-4">
              <SkeletonPanel rows={4} className="mb-0" />
              <SkeletonPanel rows={3} className="mb-0" />
            </div>
          </div>
        }
      />
    );
  }
  if (error && !settings) return <ListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <EmptyState title="暂无配置项" />;

  const groupFor = (key: Exclude<SettingsTabKey, 'security'>) =>
    visibleGroups.find((group) => group.key === key);
  const activeMeta = activeTab === 'security' ? null : CONFIG_TAB_META[activeTab];
  const activeGroup = activeTab === 'security' ? undefined : groupFor(activeTab);
  const activeDirty = changedKeys.filter((key) => key.startsWith(`${activeTab}.`)).length;
  const activeReadOnly =
    activeGroup !== undefined &&
    activeGroup.items.length > 0 &&
    activeGroup.items.every((item) => item.readOnly);

  const renderConfigTab = (key: Exclude<SettingsTabKey, 'security'>) => {
    const meta = CONFIG_TAB_META[key];
    const group = groupFor(key);
    const tabDirty = changedKeys.filter((item) => item.startsWith(`${key}.`)).length;
    const tabReadOnly =
      group !== undefined &&
      group.items.length > 0 &&
      group.items.every((item) => item.readOnly);

    return (
      <TabsContent value={key} className="min-w-0">
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
                      value={item.key in draft ? draft[item.key] : item.value}
                      isDraft={item.key in draft}
                      isClearing={clears.has(item.key)}
                      editable={editable}
                      onChange={(value) => setValue(item.key, value)}
                      onRevert={() => revert(item.key)}
                      onClear={() => requestClear(item.key)}
                    />
                  ))}
                </div>
              )}
            </Panel>

            {editable && dirtyCount > 0 && (
              <SaveBar className="mt-4">
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  共 {dirtyCount} 项变更待保存
                  {clears.size > 0 ? `，其中 ${clears.size} 项恢复默认` : ''}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <ActionButton
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setDraft({});
                      setClears(new Set());
                    }}
                  >
                    放弃变更
                  </ActionButton>
                  <ActionButton disabled={busy} onClick={() => setConfirming(true)}>
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
              note={dirtyCount > 0 ? `共 ${dirtyCount} 项` : '当前无变更'}
            >
              {dirtyCount > 0 ? (
                <ul className="flex flex-col gap-2.5">
                  {changeSummary.slice(0, 5).map((change) => (
                    <li key={change.key} className="min-w-0 text-[12px] leading-5">
                      <p className="truncate font-medium text-foreground" title={change.label}>
                        {change.label}
                      </p>
                      <p className="truncate text-muted-foreground" title={`${change.from} → ${change.to}`}>
                        {change.from} → <span className="font-medium text-warn-text">{change.to}</span>
                      </p>
                    </li>
                  ))}
                  {changeSummary.length > 5 && (
                    <li className="text-[12px] text-muted-foreground">
                      另有 {changeSummary.length - 5} 项，请在保存确认中查看。
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
  };

  return (
    <AdminPage
      title="系统设置"
      description={
        editable
          ? '管理上传边界、冻结积分退回与数据备份。修改统一保存，生效时机以确认提示为准。'
          : '当前账号无 setting.write 权限，仅可查看。'
      }
      actions={
        editable ? (
          dirtyCount > 0 ? (
            <ToneBadge tone="warn">{dirtyCount} 项待保存</ToneBadge>
          ) : undefined
        ) : (
          <ToneBadge tone="neutral">只读</ToneBadge>
        )
      }
    >
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <AdminTabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isSettingsTabKey(value) || value === activeTab) return;
          navigate(settingGroupPath(value), { replace: true });
        }}
        items={SETTINGS_TABS}
        ariaLabel="系统设置"
      >
        {renderConfigTab('generate')}
        {renderConfigTab('upload')}
        {renderConfigTab('backup')}
        <TabsContent value="security" className="min-w-0">
          <SettingsSecurityTab />
        </TabsContent>
      </AdminTabs>

      <ModalDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(false);
        }}
        title="保存系统设置"
        description="以下变更将写入运行时配置；每项生效时机见变更说明。"
        size="sm"
        footer={
          <>
            <ActionButton variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </ActionButton>
            <ActionButton disabled={busy} onClick={() => void save()}>
              {busy && <Spinner aria-hidden />}
              {busy ? '保存中…' : '确认保存'}
            </ActionButton>
          </>
        }
      >
        {activeMeta && (
          <p className="mb-3 text-[12px] leading-5 text-muted-foreground">
            {activeMeta.title}：{activeMeta.note}
          </p>
        )}
        {changeSummary.length > 0 && (
          <div className="rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn-text">
            <div className="font-medium">本次变更</div>
            <ul className="mt-2 flex flex-col gap-2">
              {changeSummary.map((change) => (
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
    </AdminPage>
  );
}
