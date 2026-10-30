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
import { FormField } from '../../admin-ui/primitives';
import { NumberInput, SwitchBox, TabGroup, TextInput } from '../../admin-ui/controls';
import type { AdminSettingField, AdminSettings } from '../../types/api';

type SettingItem = AdminSettings['groups'][number]['items'][number];

/**
 * 系统设置。
 *
 * ## 草稿模型
 *
 * 表单改动只落在本地 `draft`（只存被改动过的项），点「保存变更」才提交。
 * 这样运营可以先改好几项再一起提交，也让「离开页面会丢什么」这件事是显式的。
 *
 * 保存走 `ConfirmAction`：变更逐项列出「旧值 → 新值」，原因必填并写入审计
 * —— 退款窗口、存储后端这类项改错一次就是事故，事后必须能回答「谁为什么改」。
 */
export function AdminSettingsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const editable = can('setting.write');

  const [activeGroup, setActiveGroup] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // 草稿: key -> value。仅存被改动过的项, 避免每次输入都发请求
  const [draft, setDraft] = useState<Partial<Record<AdminSettingField, string | number | boolean>>>({});
  const [confirming, setConfirming] = useState(false);
  const [saveReason, setSaveReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  const { data: settings, loading, error, reload } = useAdminResource(() => adminSettingsApi.read());

  /*
   * 首次拿到配置后落到第一个分组。必须放 effect 而不能塞进 fetcher:
   * 保存后 `reload()` 会重新拉一次, 塞进 fetcher 就会把用户当前停留的
   * 分页签冲回第一组 (保存的是「退款」却跳回「通用」, 得重新找一遍)。
   */
  useEffect(() => {
    if (!settings) return;
    setActiveGroup((prev) => prev || settings.groups[0]?.key || '');
  }, [settings]);

  const changed = Object.keys(draft) as AdminSettingField[];
  /** 系统设置是低频长表单，误点侧栏离开的代价很高 */
  useUnsavedGuard(changed.length > 0);

  const setValue = (key: AdminSettingField, value: string | number | boolean) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /** 恢复某项为已保存的值 */
  const revert = (key: AdminSettingField) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const save = async () => {
    const reason = saveReason.trim();
    if (!reason) {
      setReasonError(true);
      return;
    }
    setBusy(true);
    try {
      const res = await adminSettingsApi.update({ ...draft, reason });
      setDraft({});
      setSaveReason('');
      setReasonError(false);
      await reload();
      setConfirming(false);
      toast.success(`已保存 ${res.updated.length} 项配置`);
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
    return changed.map((key) => {
      const item = all.find((i) => i.field === key);
      return {
        label: item?.label ?? key,
        from: item ? String(item.value) : '—',
        to: String(draft[key]),
      };
    });
  }, [settings, draft, changed]);

  /*
   * 2026-10-23: 保存成功后要重拉配置 (校验并回填服务端归一化后的值)。
   * 守卫从无条件的 `if (loading)` 收窄成「还没有数据时才塌」, 否则整页
   * 先塌成骨架屏再弹回来 —— 分页签与草稿都还在 state 里, 视觉上却像
   * "保存把页面弄崩了重载"。加载过之后刷新只换内容。
   */
  if (loading && !settings) return <AdminListLoading tip="加载系统设置…" />;
  if (error && !settings) return <AdminListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <AdminEmpty description="暂无配置项" />;

  const renderControl = (item: SettingItem) => {
    const value = item.field in draft ? draft[item.field] : item.value;

    if (item.type === 'boolean') {
      return (
        <SwitchBox
          checked={Boolean(value)}
          onChange={(checked) => setValue(item.field, checked)}
          disabled={!editable}
          aria-label={item.label}
        />
      );
    }

    if (item.type === 'number') {
      return (
        <NumberInput
          value={Number(value)}
          min={item.min}
          max={item.max}
          onChange={(next) => setValue(item.field, Number(next ?? item.default))}
          disabled={!editable}
          ariaLabel={item.label}
          className="w-40"
        />
      );
    }

    return (
      <TextInput
        value={String(value)}
        onChange={(next) => setValue(item.field, next)}
        disabled={!editable}
        ariaLabel={item.label}
      />
    );
  };

  return (
    <>
      <PageHeader
        title="系统设置"
        description={
          editable
            ? '修改后点右下角「保存变更」提交；配置立即生效'
            : '当前账号无 setting.write 权限，仅可查看'
        }
      />

      {/* 刷新失败但配置还在: 页面必须让用户知道「屏幕上这份可能已过期」——
          系统设置里改错一个退款窗口或存储后端都不是小事 */}
      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <TabGroup
        value={activeGroup}
        onChange={setActiveGroup}
        ariaLabel="配置分组"
        tabs={settings.groups.map((group) => ({
          id: group.key,
          label: group.label,
          content: (
            <Panel isNarrow className="mb-0">
              {group.items.length === 0 ? (
                <AdminEmpty description="该分组暂无配置项" />
              ) : (
                <div className="flex flex-col divide-y divide-border-table">
                  {group.items.map((item) => {
                    const dirty = item.field in draft;
                    return (
                      <div key={item.key} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text-primary">{item.label}</span>
                            {item.overridden && (
                              <span
                                className="rounded bg-accent-50 px-1.5 py-0.5 text-[11px] text-accent-700"
                                title="已覆盖代码默认值"
                              >
                                已自定义
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs leading-5 text-text-tertiary">
                            {item.description}
                          </div>
                          {item.type === 'number' &&
                            (item.min !== undefined || item.max !== undefined) && (
                              <div className="mt-0.5 text-[11px] text-text-tertiary">
                                取值范围 {item.min ?? '—'} ~ {item.max ?? '—'}（默认 {item.default}）
                              </div>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {renderControl(item)}
                          {dirty && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => revert(item.field)}
                              disabled={!editable}
                            >
                              撤销
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
        }))}
      />

      {/*
       * 之前这里写死「尚未开放：法务文本 / 投诉举报」，但两页早已上线，
       * 运营会被误导为功能没交付。改成真实入口，随菜单权限一起生效即可。
       */}
      <Panel isNarrow title="相关管理入口">
        <ul className="flex flex-col gap-2">
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
        <div className="sticky bottom-0 z-10 mt-3 flex items-center gap-3 rounded-xl border border-border-table bg-white px-4 py-2.5 shadow-lg">
          <span className="min-w-0 flex-1 text-xs text-text-secondary">
            {changed.length === 0 ? '无未保存的变更' : `有 ${changed.length} 项未保存的变更`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              disabled={changed.length === 0 || busy}
              onClick={() => setDraft({})}
            >
              放弃变更
            </Button>
            <Button
              variant="primary"
              size="small"
              disabled={changed.length === 0 || busy}
              onClick={() => {
                setSaveReason('');
                setReasonError(false);
                setConfirming(true);
              }}
            >
              保存变更
            </Button>
          </div>
        </div>
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
