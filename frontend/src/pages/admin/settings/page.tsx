import { useEffect, useMemo, useState } from 'react';
import { SettingItem } from './constants';
import { displayValue } from './utils';
import { useAdmin, useToast, useUnsavedGuard, useAdminResource } from './hooks';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';

import { adminSettingsApi } from '../../../lib/api';

import { ActionButton, ClearableField, EmptyState, FormField, ListError, ModalDialog, NumberField, PageHeader, PageSkeleton, SkeletonPanel, SkeletonTabs, Panel, SaveBar, SegmentedTabs, SelectField, StaleError, SwitchField, TextField, ToneBadge } from './components';
import type { AdminSettings, AdminSettingValue } from '../../../types/api';
import { auditReason } from '../../../admin-ui/lib/auditReason';

/** 值 → 展示文本。布尔值不能直接显示 true/false，运营看不懂 */

/**
 * 系统设置。
 *
 * ## 契约
 *
 * 提交格式与后端 `UpdateSettingsDto` 一致：`{ settings, clears, reason }`。
 * `settings` 用 `SETTING_DEFS` 的点号键（如 `upload.maxSizeMb`）；
 * `clears` 表示删除运行时覆盖、回落代码默认值 —— 与「把值改成默认值」在
 * 审计上是两件事，不能混用。
 *
 * ## 草稿模型
 *
 * 表单改动只落在本地 `draft`，点「保存变更」才提交。只读项不渲染控件：
 * 一个能拖动却不生效的开关，比没有这个开关更糟。
 */
export function AdminSettingsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const editable = can('setting.write');

  const [activeGroup, setActiveGroup] = useState<string>('');
  const [busy, setBusy] = useState(false);

  /** key -> 新值。仅存被改动过的项 */
  const [draft, setDraft] = useState<Record<string, AdminSettingValue>>({});
  /** 待恢复默认的 key。与 draft 互斥，保存前任一处修改都会把 key 从另一侧移走 */
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const { data: settings, loading, error, reload } = useAdminResource(() =>
    adminSettingsApi.read(),
  );

  /*
   * 首次拿到配置后落到第一个分组。必须放 effect 而不能塞进 fetcher：
   * 保存后 `reload()` 会重新拉一次，塞进 fetcher 就会把用户当前停留的
   * 分组页签冲回第一组。
   */
  useEffect(() => {
    if (!settings) return;
    setActiveGroup((prev) => prev || settings.groups[0]?.key || '');
  }, [settings]);

  const changedKeys = useMemo(
    () => [...new Set([...Object.keys(draft), ...clears])],
    [draft, clears],
  );
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
        settings: Object.fromEntries(
          Object.entries(draft).filter(([key]) => !clears.has(key)),
        ),
        clears: [...clears],
        reason: auditReason('更新系统设置'),
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
            ? '修改后点右下角「保存变更」提交；配置立即生效，已自定义的项可恢复默认'
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

  const renderControl = (item: SettingItem) => {
    if (item.readOnly) {
      return (
        <span className="inline-flex h-9 items-center rounded-md border border-input bg-muted px-2.5 text-xs text-muted-foreground">
          {displayValue(item.value, item.type)}
        </span>
      );
    }

    const value = item.key in draft ? draft[item.key] : item.value;

    if (item.type === 'boolean') {
      return (
        <SwitchField
          checked={Boolean(value)}
          onChange={(checked) => setValue(item.key, checked)}
          disabled={!editable}
          ariaLabel={item.label}
        />
      );
    }

    if (item.type === 'number') {
      if (item.enum && item.enum.length > 0) {
        return (
          <SelectField
            value={String(value)}
            onChange={(next) => next !== undefined && setValue(item.key, Number(next))}
            options={item.enum.map((n) => ({ value: String(n), label: String(n) }))}
            ariaLabel={item.label}
            disabled={!editable}
            className="w-40"
          />
        );
      }
      return (
        <NumberField
          value={Number(value)}
          min={item.min}
          max={item.max}
          onChange={(next) => setValue(item.key, Number(next ?? item.default))}
          disabled={!editable}
          ariaLabel={item.label}
          className="w-40"
        />
      );
    }

    return (
      <TextField
        value={String(value)}
        onChange={(next) => setValue(item.key, next)}
        disabled={!editable}
        ariaLabel={item.label}
        maxLength={item.maxLength}
      />
    );
  };

  const activeGroupData = settings.groups.find((group) => group.key === activeGroup);

  return (
    <>
      <PageHeader
        title="系统设置"
        description={
          editable
            ? '修改后点右下角「保存变更」提交；配置立即生效，已自定义的项可恢复默认'
            : '当前账号无 setting.write 权限，仅可查看'
        }
      />

      {/* 刷新失败但配置还在：页面必须让用户知道「屏幕上这份可能已过期」 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      {/*
       * 分组页签用胶囊式而不是下划线式：分组是「同一批配置按领域切」，
       * 胶囊的选中态比下划线更显眼 —— 运营在长表单里最容易丢的是
       * 「我正在改哪一组」。
       */}
      <SegmentedTabs
        value={activeGroup}
        onChange={setActiveGroup}
        ariaLabel="配置分组"
        options={settings.groups.map((group) => ({
          value: group.key,
          label: `${group.label} ${group.items.length}`,
        }))}
        className="mb-4"
      />

      {activeGroupData && (
        <Panel
          narrow
          className="mb-0"
          title={`${activeGroupData.label} · 共 ${activeGroupData.items.length} 项`}
          note={`${activeGroupData.items.filter((item) => !item.readOnly).length} 项可编辑${
            activeGroupData.items.some((item) => item.readOnly)
              ? '，其余为只读配置地图'
              : ''
          }`}
        >
          {activeGroupData.items.length === 0 ? (
            <EmptyState title="该分组暂无配置项" />
          ) : (
            <div className="flex flex-col">
              {activeGroupData.items.map((item) => {
                const isDraft = item.key in draft;
                const isClearing = clears.has(item.key);
                return (
                  <div
                    key={item.key}
                    className="flex items-start gap-4 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{item.label}</span>
                        {item.readOnly && <ToneBadge tone="neutral">只读</ToneBadge>}
                        {item.overridden && !isClearing && (
                          <ToneBadge tone="brand" className="cursor-help">
                            <span title="已覆盖代码默认值">已自定义</span>
                          </ToneBadge>
                        )}
                        {isClearing && <ToneBadge tone="warn">待恢复默认</ToneBadge>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        <span>默认值：{displayValue(item.default, item.type)}</span>
                        {item.type === 'number' &&
                          (item.min !== undefined || item.max !== undefined) && (
                            <span>
                              取值范围 {item.min ?? '—'} ~ {item.max ?? '—'}
                            </span>
                          )}
                        {item.updatedBy && (
                          <span>
                            上次修改：{item.updatedBy}
                            {item.updatedAt
                              ? ` · ${new Date(item.updatedAt).toLocaleString('zh-CN')}`
                              : ''}
                          </span>
                        )}
                        {item.linkTo && (
                          <Link className="text-brand hover:underline" to={item.linkTo}>
                            前往配置 →
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {renderControl(item)}
                      {!item.readOnly && (isDraft || isClearing) && (
                        <ActionButton
                          variant="ghost"
                          size="xs"
                          onClick={() => revert(item.key)}
                          disabled={!editable}
                        >
                          撤销
                        </ActionButton>
                      )}
                      {!item.readOnly && item.overridden && !isClearing && editable && (
                        <ActionButton
                          variant="ghost"
                          size="xs"
                          onClick={() => requestClear(item.key)}
                        >
                          恢复默认
                        </ActionButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      <Panel narrow title="相关管理入口" className="mt-4">
        <ul className="flex flex-col gap-2.5">
          <li className="flex items-baseline gap-2">
            <Link className="text-sm font-medium text-brand hover:underline" to="/admin/channels">
              渠道工作台
            </Link>
            <span className="text-xs text-muted-foreground">上游渠道、渠道模型与协议</span>
          </li>
          <li className="flex items-baseline gap-2">
            <Link className="text-sm font-medium text-brand hover:underline" to="/admin/backups">
              数据备份
            </Link>
            <span className="text-xs text-muted-foreground">备份频次、恢复验证与保留份数</span>
          </li>
          <li className="flex items-baseline gap-2">
            <Link className="text-sm font-medium text-brand hover:underline" to="/admin/legal">
              法务文档
            </Link>
            <span className="text-xs text-muted-foreground">
              用户协议 / 隐私政策 / 未成年人保护 / 账号规则的版本与发布
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <Link className="text-sm font-medium text-brand hover:underline" to="/admin/tickets">
              工单处理
            </Link>
            <span className="text-xs text-muted-foreground">用户投诉、举报与咨询的受理和答复</span>
          </li>
        </ul>
      </Panel>

      {editable && (
        <SaveBar narrow>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {dirtyCount === 0
              ? '无未保存的变更'
              : `有 ${dirtyCount} 项未保存的变更${
                  clears.size > 0 ? `（其中 ${clears.size} 项将恢复默认）` : ''
                }`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <ActionButton
              variant="secondary"
              disabled={dirtyCount === 0 || busy}
              onClick={() => {
                setDraft({});
                setClears(new Set());
              }}
            >
              放弃变更
            </ActionButton>
            <ActionButton
              disabled={dirtyCount === 0 || busy}
              onClick={() => setConfirming(true)}
            >
              保存变更
            </ActionButton>
          </div>
        </SaveBar>
      )}

      {/*
       * 保存确认用弹层而不是页面内确认条：确认条会插在保存条上方改变文档流，
       * 用户无法对照着看「影响范围」里的每一项；弹层不改变文档流。
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
            <ActionButton
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              取消
            </ActionButton>
            <ActionButton disabled={busy} onClick={() => void save()}>
              <RotateCcw className={busy ? 'animate-spin' : undefined} />
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
