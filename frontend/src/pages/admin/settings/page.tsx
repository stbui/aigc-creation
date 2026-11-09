import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { RELATED_ENTRIES } from './constants';
import { SettingItemRow } from './SettingItemRow';
import { displayValue, groupSummary } from './utils';
import { useAdmin, useToast, useUnsavedGuard, useAdminResource } from './hooks';

import { adminSettingsApi } from '../../../lib/api';

import {
  ActionButton,
  EmptyState,
  ListError,
  ModalDialog,
  PageHeader,
  PageSkeleton,
  Panel,
  SaveBar,
  SegmentedTabs,
  Separator,
  SkeletonPanel,
  SkeletonTabs,
  StaleError,
  ToneBadge,
} from '~/admin-ui/primitives';
import type { AdminSettingValue } from '../../../types/api';

/**
 * 系统设置。
 *
 * ## 契约
 *
 * 提交格式与后端 `UpdateSettingsDto` 一致：`{ settings, clears }`。
 * `settings` 用 `SETTING_DEFS` 的点号键（如 `upload.maxSizeMb`）；
 * `clears` 表示删除运行时覆盖、回落代码默认值 —— 与「把值改成默认值」在
 * 审计上是两件事，不能混用。
 *
 * ## 草稿模型
 *
 * 表单改动只落在本地 `draft`，点「保存变更」才提交。只读项不渲染控件：
 * 一个能拖动却不生效的开关，比没有这个开关更糟。
 *
 * ## 版面
 *
 * 「分组页签 + 窄面板」是低频长表单的既有约定：760 的阅读宽度能保证说明
 * 文字不横跨整屏，分组的已保存/待保存状态由页签上的圆点与页头徽标共同
 * 承担，用户不必记住自己在哪一组改过什么。
 */
export function AdminSettingsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const editable = can('setting.write');

  const [activeGroup, setActiveGroup] = useState<string>('');
  const [busy, setBusy] = useState(false);
  /*
   * 分组深链：`?group=refund` 直达某一组配置。
   *
   * 没有它时「去退款规则改比例上限」只能先进系统设置再在八个页签里找
   * 那个叫「退款」的 —— 规则被拒时运营要的就是那一组本身。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const groupParam = searchParams.get('group');

  /** key -> 新值。仅存被改动过的项 */
  const [draft, setDraft] = useState<Record<string, AdminSettingValue>>({});
  /** 待恢复默认的 key。与 draft 互斥，保存前任一处修改都会把 key 从另一侧移走 */
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const { data: settings, loading, error, reload } = useAdminResource(() => adminSettingsApi.read());

  /*
   * 首次拿到配置后落到首个分组。必须放 effect 而不能塞进 fetcher：
   * 保存后 `reload()` 会重新拉一次，塞进 fetcher 就会把用户当前停留的
   * 分组页签冲回第一组。
   */
  useEffect(() => {
    if (!settings) return;
    const groups = settings.groups;
    // URL 上的分组不存在（手改链接 / 分组被删）时回落到首个分组，不留空面板
    const wanted = groupParam && groups.some((g) => g.key === groupParam) ? groupParam : groups[0]?.key || '';
    setActiveGroup((prev) => {
      // URL 指定的分组优先：深链进来必须落在那一组
      if (groupParam) return wanted;
      return prev || wanted;
    });
  }, [settings, groupParam]);

  /*
   * 分组写回地址栏：`replace` 避免每切一次页签压一条历史。
   * 深链进来后分组是唯一的页内状态，不写回的话刷新就退回第一组。
   *
   * 写回用实时地址栏做基底（不能拿 hook 快照），否则会冲掉同一轮里
   * 别的 hook 刚写进去的参数。
   */
  useEffect(() => {
    if (!activeGroup) return;
    const next = new URLSearchParams(window.location.search);
    if (next.get('group') === activeGroup) return;
    next.set('group', activeGroup);
    setSearchParams(next, { replace: true });
  }, [activeGroup, setSearchParams]);

  const changedKeys = useMemo(() => [...new Set([...Object.keys(draft), ...clears])], [draft, clears]);
  const dirtyCount = changedKeys.length;
  /** 系统设置是低频长表单，误点侧栏离开的代价很高 */
  useUnsavedGuard(dirtyCount > 0);

  const setValue = (key: string, value: AdminSettingValue) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setClears((c) => {
      if (!c.has(key)) return c;
      const next = new Set(c);
      next.delete(key);
      return next;
    });
  };

  /** 撤销本地修改：回到已保存值 */
  const revert = (key: string) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    setClears((c) => {
      if (!c.has(key)) return c;
      const next = new Set(c);
      next.delete(key);
      return next;
    });
  };

  /** 恢复默认：删除运行时覆盖，回落代码默认值 */
  const requestClear = (key: string) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    setClears((c) => new Set(c).add(key));
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await adminSettingsApi.update({
        settings: Object.fromEntries(Object.entries(draft).filter(([key]) => !clears.has(key))),
        clears: [...clears],
      });
      setDraft({});
      setClears(new Set());
      await reload();
      setConfirming(false);
      toast.success(
        res.cleared.length > 0
          ? `已保存 ${res.updated.length} 项、恢复默认 ${res.cleared.length} 项`
          : `已保存 ${res.updated.length} 项配置`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 变更说明：逐项对比已保存值与草稿值 */
  const changeSummary = useMemo(() => {
    if (!settings) return [];
    const all = settings.groups.flatMap((g) => g.items);
    return changedKeys.map((key) => {
      const item = all.find((i) => i.key === key);
      if (clears.has(key)) {
        return {
          label: item?.label ?? key,
          from: item ? displayValue(item.value, item.type) : '—',
          to: `${item ? displayValue(item.default, item.type) : '—'}（恢复默认）`,
        };
      }
      return {
        label: item?.label ?? key,
        from: item ? displayValue(item.value, item.type) : '—',
        to: displayValue(draft[key], item?.type ?? 'string'),
      };
    });
  }, [settings, draft, clears, changedKeys]);

  /** key -> 所属分组。页签上的未保存圆点与分组副标题都靠它 */
  const keyToGroup = useMemo(() => {
    const map = new Map<string, string>();
    settings?.groups.forEach((group) => {
      group.items.forEach((item) => map.set(item.key, group.key));
    });
    return map;
  }, [settings]);

  const dirtyByGroup = useMemo(() => {
    const map = new Map<string, number>();
    changedKeys.forEach((key) => {
      const group = keyToGroup.get(key);
      if (group) map.set(group, (map.get(group) ?? 0) + 1);
    });
    return map;
  }, [changedKeys, keyToGroup]);

  /*
   * 页头照常渲染：加载期间标题与说明就该在位。
   * 之前的守卫整页替换，首屏先闪一段没有标题的灰条，再冒出完整页面 ——
   * 骨架该占住位置，不是把版面清空。
   *
   * 面板限宽 760：与真实窄版 `Panel` 同宽，数据到位时不会横向缩一下。
   */
  if (loading && !settings) {
    return (
      <PageSkeleton
        title="系统设置"
        description={
          editable
            ? '调整全站运行参数；保存后立即生效，已自定义的值可恢复为代码默认值'
            : '当前账号无 setting.write 权限，仅可查看'
        }
        /*
         * 设置页的版面是「分组页签 + 窄面板 + 一块静态入口面板」。分组页签
         * 的选项来自接口，加载期没有 —— 用一根灰条占位，宽度对得上胶囊排布。
         */
        body={
          <>
            <SkeletonTabs />
            <SkeletonPanel rows={6} narrow />
            <SkeletonPanel rows={4} narrow />
          </>
        }
      />
    );
  }
  if (error && !settings) return <ListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <EmptyState title="暂无配置项" />;

  const activeGroupData = settings.groups.find((group) => group.key === activeGroup);
  const activeGroupDirty = activeGroupData ? (dirtyByGroup.get(activeGroupData.key) ?? 0) : 0;
  const relatedEntries = RELATED_ENTRIES.filter((entry) => can(entry.permission));

  return (
    <>
      <PageHeader
        title="系统设置"
        className="max-w-[760px]"
        description={
          editable
            ? '调整全站运行参数；保存后立即生效，已自定义的值可恢复为代码默认值'
            : '当前账号无 setting.write 权限，仅可查看'
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
      />

      {/* 刷新失败但配置还在：页面必须让用户知道「屏幕上这份可能已过期」 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <div className="grid grid-cols-[minmax(0,760px)_minmax(280px,1fr)] items-start gap-4">
        <div className="min-w-0">
          {/*
           * 分组页签用胶囊式而不是下划线式：分组是「同一批配置按领域切」，
           * 胶囊的选中态比下划线更显眼 —— 运营在长表单里最容易丢的是
           * 「我正在改哪一组」。计数与未保存圆点都挂在页签上，切换分组前
           * 就能看到哪一组还有改动。
           */}
          <SegmentedTabs
            value={activeGroup}
            onChange={setActiveGroup}
            ariaLabel="配置分组"
            options={settings.groups.map((group) => ({
              value: group.key,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {group.label}
                  <span className="text-[12px] font-normal text-muted-foreground tabular-nums">{group.items.length}</span>
                  {(dirtyByGroup.get(group.key) ?? 0) > 0 && (
                    <>
                      <span className="size-1.5 rounded-full bg-warn-text" aria-hidden />
                      <span className="sr-only">有未保存的变更</span>
                    </>
                  )}
                </span>
              ),
            }))}
            className="mb-4"
          />

          {activeGroupData && (
            <Panel
              narrow
              className="mb-0"
              title={activeGroupData.label}
              note={
                <>
                  {groupSummary(activeGroupData)}
                  {activeGroupDirty > 0 && (
                    <>
                      <span className="mx-1.5">·</span>
                      <span className="font-medium text-warn-text">{activeGroupDirty} 项待保存</span>
                    </>
                  )}
                </>
              }
            >
              {activeGroupData.items.length === 0 ? (
                <EmptyState title="该分组暂无配置项" />
              ) : (
                <div className="flex flex-col">
                  {activeGroupData.items.map((item) => (
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
          )}

          {relatedEntries.length > 0 && (
            <Panel narrow title="相关管理入口" className="mt-4">
              <ul className="flex flex-col">
                {relatedEntries.map((entry) => (
                  <li key={entry.to}>
                    <Link
                      to={entry.to}
                      className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <entry.icon
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brand"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-foreground group-hover:text-brand">
                          {entry.label}
                        </span>
                        <span className="block text-[12px] leading-5 text-muted-foreground">{entry.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside
          data-testid="admin-settings-context"
          aria-label="配置编辑状态"
          className="sticky top-4 rounded-lg border border-border bg-card p-4 shadow-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">编辑状态</p>
              <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                {activeGroupData?.label ?? '当前分组'} · {activeGroupData?.items.length ?? 0} 项配置
              </p>
            </div>
            <ToneBadge tone={dirtyCount > 0 ? 'warn' : editable ? 'success' : 'neutral'}>
              {dirtyCount > 0 ? `${dirtyCount} 项待保存` : editable ? '已保存' : '只读'}
            </ToneBadge>
          </div>

          <div className="mt-3 rounded-md bg-muted/40 px-3 py-2.5">
            {dirtyCount > 0 ? (
              <ul className="flex flex-col gap-2">
                {changeSummary.slice(0, 5).map((change) => (
                  <li key={change.label} className="flex min-w-0 flex-col gap-0.5 text-[12px] leading-4">
                    <span className="truncate font-medium text-foreground" title={change.label}>{change.label}</span>
                    <span className="truncate text-muted-foreground" title={`${change.from} → ${change.to}`}>
                      {change.from} → <span className="text-warn-text">{change.to}</span>
                    </span>
                  </li>
                ))}
                {changeSummary.length > 5 && (
                  <li className="text-[12px] text-muted-foreground">另有 {changeSummary.length - 5} 项变更</li>
                )}
              </ul>
            ) : (
              <p className="text-[12px] leading-5 text-muted-foreground">
                {editable
                  ? '当前没有待保存的变更。修改任意配置项后，这里会列出保存前后的差异。'
                  : '当前账号只可查看配置，不能保存修改。'}
              </p>
            )}
          </div>

          <Separator className="my-3" />
          <p className="text-[12px] font-medium text-foreground">生效规则</p>
          <ul className="mt-2 flex flex-col gap-2 text-[12px] leading-5 text-muted-foreground">
            <li>点击“保存变更”并确认后，配置立即对全站生效。</li>
            <li>“恢复默认”会删除运行时覆盖，并保留审计记录。</li>
            <li>存在未保存修改时，离开页面会先要求确认。</li>
          </ul>
        </aside>
      </div>

      {/* 没有改动时不占版面：常驻的「无未保存的变更」只是噪声 */}
      {editable && dirtyCount > 0 && (
        <SaveBar narrow>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            有 {dirtyCount} 项未保存的变更
            {clears.size > 0 ? `（其中 ${clears.size} 项将恢复默认）` : ''}
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

      {/*
       * 保存确认走弹层：弹层不改变文档流，用户可对照「影响范围」逐项确认，
       * 加载期间也不会把保存条挤走。
       */}
      <ModalDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(false);
        }}
        title="保存系统设置"
        description="以下配置变更将立即生效，影响所有用户。"
        width={560}
        footer={
          <>
            <ActionButton variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </ActionButton>
            <ActionButton disabled={busy} onClick={() => void save()}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? '保存中…' : '确认保存'}
            </ActionButton>
          </>
        }
      >
        {changeSummary.length > 0 && (
          <div className="mb-4 rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn-text">
            <div className="font-medium">影响范围</div>
            <ul className="mt-1 list-disc pl-4">
              {changeSummary.map((change) => (
                <li key={change.label}>
                  {change.label}：{change.from} → {change.to}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModalDialog>
    </>
  );
}
