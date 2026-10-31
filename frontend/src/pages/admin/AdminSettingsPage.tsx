import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminSettingsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import { FormField, SaveBar } from '../../admin-ui/primitives';
import { NumberInput, SelectBox, SwitchBox, TabGroup, TextInput } from '../../admin-ui/controls';
import type { AdminSettings, AdminSettingValue } from '../../types/api';

type SettingItem = AdminSettings['groups'][number]['items'][number];

/** 值 → 展示文本。布尔值不能直接显示 true/false，运营看不懂 */
function displayValue(value: AdminSettingValue, type: SettingItem['type']): string {
  if (type === 'boolean') return value ? '开启' : '关闭';
  return String(value);
}

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
  const [saveReason, setSaveReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  const { data: settings, loading, error, reload } = useAdminResource(() => adminSettingsApi.read());

  /*
   * 首次拿到配置后落到第一个分组。必须放 effect 而不能塞进 fetcher:
   * 保存后 `reload()` 会重新拉一次, 塞进 fetcher 就会把用户当前停留的
   * 分页签冲回第一组。
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
    const reason = saveReason.trim();
    if (!reason) {
      setReasonError(true);
      return;
    }
    setBusy(true);
    try {
      const res = await adminSettingsApi.update({
        settings: Object.fromEntries(
          Object.entries(draft).filter(([key]) => !clears.has(key)),
        ),
        clears: [...clears],
        reason,
      });
      setDraft({});
      setClears(new Set());
      setSaveReason('');
      setReasonError(false);
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

  /** 变更说明: 逐项对比已保存值与草稿值 */
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

  if (loading && !settings) return <AdminListLoading tip="加载系统设置…" />;
  if (error && !settings) return <AdminListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <AdminEmpty description="暂无配置项" />;

  const renderControl = (item: SettingItem) => {
    if (item.readOnly) {
      return (
        <span className="inline-flex h-8 items-center rounded-md border border-border-table bg-background-secondary-default px-2.5 text-xs text-text-secondary">
          {displayValue(item.value, item.type)}
        </span>
      );
    }

    const value = item.key in draft ? draft[item.key] : item.value;

    if (item.type === 'boolean') {
      return (
        <SwitchBox
          checked={Boolean(value)}
          onChange={(checked) => setValue(item.key, checked)}
          disabled={!editable}
          aria-label={item.label}
        />
      );
    }

    if (item.type === 'number') {
      if (item.enum && item.enum.length > 0) {
        return (
          <SelectBox
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
        <NumberInput
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
      <TextInput
        value={String(value)}
        onChange={(next) => setValue(item.key, next)}
        disabled={!editable}
        ariaLabel={item.label}
        maxLength={item.maxLength}
      />
    );
  };

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

      {/* 刷新失败但配置还在: 页面必须让用户知道「屏幕上这份可能已过期」 */}
      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <TabGroup
        value={activeGroup}
        onChange={setActiveGroup}
        ariaLabel="配置分组"
        tabs={settings.groups.map((group) => {
          const editableCount = group.items.filter((item) => !item.readOnly).length;
          return {
            id: group.key,
            label: `${group.label} ${group.items.length}`,
            content: (
              <Panel
                isNarrow
                className="mb-0"
                title={`${group.label} · 共 ${group.items.length} 项`}
                note={`${editableCount} 项可编辑${editableCount < group.items.length ? '，其余为只读配置地图' : ''}`}
              >
                {group.items.length === 0 ? (
                  <AdminEmpty description="该分组暂无配置项" />
                ) : (
                  <div className="flex flex-col divide-y divide-border-table">
                    {group.items.map((item) => {
                      const isDraft = item.key in draft;
                      const isClearing = clears.has(item.key);
                      return (
                        <div key={item.key} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-text-primary">{item.label}</span>
                              {item.readOnly && (
                                <span className="rounded bg-background-secondary-default px-1.5 py-0.5 text-[11px] text-text-tertiary">
                                  只读
                                </span>
                              )}
                              {item.overridden && !isClearing && (
                                <span
                                  className="rounded bg-accent-50 px-1.5 py-0.5 text-[11px] text-accent-700"
                                  title="已覆盖代码默认值"
                                >
                                  已自定义
                                </span>
                              )}
                              {isClearing && (
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                                  待恢复默认
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs leading-5 text-text-tertiary">
                              {item.description}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                              <span>
                                默认值：{displayValue(item.default, item.type)}
                              </span>
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
                                <Link className="text-accent-700 hover:underline" to={item.linkTo}>
                                  前往配置 →
                                </Link>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {renderControl(item)}
                            {!item.readOnly && (isDraft || isClearing) && (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => revert(item.key)}
                                disabled={!editable}
                              >
                                撤销
                              </Button>
                            )}
                            {!item.readOnly && item.overridden && !isClearing && editable && (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => requestClear(item.key)}
                              >
                                恢复默认
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            ),
          };
        })}
      />

      <Panel isNarrow title="相关管理入口">
        <ul className="flex flex-col gap-2">
          <li className="flex items-baseline gap-2">
            <strong>
              <Link className="text-accent-700 hover:underline" to="/admin/channels">
                渠道工作台
              </Link>
            </strong>
            <span className="text-xs text-text-tertiary">上游渠道、渠道模型与协议</span>
          </li>
          <li className="flex items-baseline gap-2">
            <strong>
              <Link className="text-accent-700 hover:underline" to="/admin/backups">
                数据备份
              </Link>
            </strong>
            <span className="text-xs text-text-tertiary">备份频次、恢复验证与保留份数</span>
          </li>
          <li className="flex items-baseline gap-2">
            <strong>
              <Link className="text-accent-700 hover:underline" to="/admin/legal">
                法务文档
              </Link>
            </strong>
            <span className="text-xs text-text-tertiary">
              用户协议 / 隐私政策 / 未成年人保护 / 账号规则的版本与发布
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <strong>
              <Link className="text-accent-700 hover:underline" to="/admin/tickets">
                工单处理
              </Link>
            </strong>
            <span className="text-xs text-text-tertiary">用户投诉、举报与咨询的受理和答复</span>
          </li>
        </ul>
      </Panel>

      {editable && (
        <SaveBar narrow>
          <span className="min-w-0 flex-1 text-xs text-text-secondary">
            {dirtyCount === 0
              ? '无未保存的变更'
              : `有 ${dirtyCount} 项未保存的变更${clears.size > 0 ? `（其中 ${clears.size} 项将恢复默认）` : ''}`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              disabled={dirtyCount === 0 || busy}
              onClick={() => {
                setDraft({});
                setClears(new Set());
              }}
            >
              放弃变更
            </Button>
            <Button
              variant="primary"
              size="small"
              disabled={dirtyCount === 0 || busy}
              onClick={() => {
                setSaveReason('');
                setReasonError(false);
                setConfirming(true);
              }}
            >
              保存变更
            </Button>
          </div>
        </SaveBar>
      )}

      {confirming && (
        <ConfirmAction
          open
          title="保存系统设置"
          confirmText="确认保存"
          loading={busy}
          description={<p>以下配置变更将立即生效，影响所有用户。</p>}
          impact={changeSummary.map((c) => `${c.label}：${c.from} → ${c.to}`)}
          extra={
            <FormField
              label="变更原因（写入审计）"
              htmlFor="adm-setting-reason"
              required
              error={reasonError ? '请填写变更原因，审计记录需要能回答「谁为什么改」。' : null}
            >
              <TextInput
                value={saveReason}
                onChange={(next) => {
                  setSaveReason(next);
                  if (next.trim()) setReasonError(false);
                }}
                placeholder="如：退款窗口由 7 天调整为 15 天"
                ariaLabel="变更原因"
              />
            </FormField>
          }
          onCancel={() => {
            setConfirming(false);
            setSaveReason('');
            setReasonError(false);
          }}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
