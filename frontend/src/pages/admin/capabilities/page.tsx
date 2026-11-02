import { useMemo, useState } from 'react';
import { useAdmin, useToast, useAdminResource, useAdminUrlFilterSync } from './hooks';
import { useSearchParams } from 'react-router-dom';
import { adminCapabilitiesApi } from '../../../lib/api';


import { ActionButton, AdminDataTable, AppliedFilters, ClearableField, ConfirmAction, FilterActions, FilterBar, HelpTip, PageHeader, Panel, SelectField, StatusTag, StaleError, TextAreaField, type AdminColumn, type AppliedFilter } from './components';
import { RUNTIME_LABELS } from '../../../lib/constants';
import type { AdminCapabilityControl } from '../../../types/api';

/**
 * 能力管控（2026-10-21）。
 *
 * 存在的理由：某项能力依赖的厂商通道挂了、或产出质量被投诉时，运营需要
 * **立刻停止收单**，而不是等下一次发版。没有这个开关，唯一手段是下掉整条
 * 模型线路 —— 那会连带影响所有能力，把局部故障放大成全站故障。
 *
 * 三列信息刻意分开，因为它们回答的是三个不同问题：
 *   实现程度 (mode)     —— 代码里做到什么程度
 *   当前结论 (effective)    —— 此刻按下去会发生什么（下架 / 云端 / 暂不可用）
 * 只显示 mode 会让「real 但没配通道」看起来像云端可用，正是要消除的误读。
 *
 * 下架**必须填原因**：原因会原样展示给 C 端用户并写进审计。只说「已下线」
 * 只能让用户去问客服，写清「云端通道维护中，预计 2 小时恢复」才是可自助的。
 *
 * 改造 (2026-10-30) 只换渲染层：筛选为客户端过滤（不请求后端），URL 同步、
 * 三态分家、下线必须填原因逐条保留。
 */
export function AdminCapabilitiesPage() {
  const toast = useToast();
  const { can } = useAdmin();
  /** 只有 capability.write 能上下线；capability.read 只读 */
  const writable = can('capability.write');
  const [saving, setSaving] = useState<string | null>(null);
  /** 下架弹窗的上下文；null = 弹窗关闭 */
  const [offline, setOffline] = useState<AdminCapabilityControl | null>(null);
  const [reason, setReason] = useState('');

  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const initialGroup = searchParams.get('group') ?? '';
  const rawRuntime = searchParams.get('runtime');
  const initialRuntime: 'remote' | 'disabled' | 'unavailable' | undefined =
    rawRuntime === 'remote' || rawRuntime === 'disabled' || rawRuntime === 'unavailable'
      ? rawRuntime
      : undefined;
  const [q, setQ] = useState(initialQ);
  const [group, setGroup] = useState(initialGroup);
  const [runtime, setRuntime] = useState<'remote' | 'disabled' | 'unavailable' | undefined>(
    initialRuntime,
  );
  useAdminUrlFilterSync({
    q: q.trim() || undefined,
    group: group || undefined,
    runtime,
  });

  // 接口历史上有过直接回数组与回 { items } 两种形状, 统一兜成数组
  const { data, loading, error, reload } = useAdminResource(async () => {
    const list = await adminCapabilitiesApi.list();
    return Array.isArray(list) ? list : [];
  });
  const rows = data ?? [];

  const groupOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.group))).sort().map((value) => ({ value, label: value })),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return rows.filter((row) => {
      const effective = row.runtime?.effective ?? 'unavailable';
      if (group && row.group !== group) return false;
      if (runtime && effective !== runtime) return false;
      if (!keyword) return true;
      return [row.name, row.capabilityId, row.group, row.modality]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [group, q, rows, runtime]);

  const appliedFilters: AppliedFilter[] = [
    q.trim()
      ? {
          key: 'q',
          label: `关键词：${q.trim()}`,
          onClear: () => setQ(''),
        }
      : null,
    group
      ? {
          key: 'group',
          label: `分组：${group}`,
          onClear: () => setGroup(''),
        }
      : null,
    runtime
      ? {
          key: 'runtime',
          label: `运行结论：${RUNTIME_LABELS[runtime]}`,
          onClear: () => setRuntime(undefined),
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];
  const hasFilter = appliedFilters.length > 0;
  const resetFilters = () => {
    setQ('');
    setGroup('');
    setRuntime(undefined);
  };

  const submitOffline = async () => {
    if (!offline) return;
    const text = reason.trim();
    if (!text) {
      toast.warning('下架必须填写原因，用户会看到它');
      return;
    }
    setSaving(offline.capabilityId);
    try {
      await adminCapabilitiesApi.set(offline.capabilityId, false, text);
      toast.success(`${offline.name} 已下线，C 端立即生效`);
      setOffline(null);
      setReason('');
      await reload();
    } catch (e) {
      toast.error((e as Error).message || '下线失败');
    } finally {
      setSaving(null);
    }
  };

  /** 上线按产品要求直接执行，不再弹窗二次确认 */
  const bringOnline = async (row: AdminCapabilityControl) => {
    setSaving(row.capabilityId);
    try {
      await adminCapabilitiesApi.set(row.capabilityId, true);
      toast.success(`${row.name} 已上线`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message || '上线失败');
    } finally {
      setSaving(null);
    }
  };

  const columns: Array<AdminColumn<AdminCapabilityControl>> = [
    {
      key: 'name',
      title: '能力',
      width: 200,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <code className="font-mono text-[12px] text-muted-foreground">{row.capabilityId}</code>
        </div>
      ),
    },
    { key: 'group', title: '分组', width: 120, render: (row) => row.group },
    {
      key: 'modality',
      title: '模态',
      width: 90,
      render: (row) => (
        <code className="font-mono text-[12px] text-muted-foreground">{row.modality}</code>
      ),
    },
    {
      key: 'mode',
      title: '实现程度',
      width: 110,
      render: (row) => (
        <HelpTip tip={row.mode === 'real' ? '已接入真实模型通道' : '参考站有、本项目未实现'}>
          <StatusTag
            status="mode"
            tone={row.mode === 'real' ? 'success' : 'warn'}
            label={row.mode === 'real' ? '已接入' : '规划中'}
          />
        </HelpTip>
      ),
    },
    {
      key: 'runtime',
      title: '当前结论',
      width: 170,
      render: (row) => {
        const eff = row.runtime?.effective ?? 'unavailable';
        return (
          <HelpTip tip={row.runtime?.reason || '尚无运行结论'}>
            <StatusTag
              status="runtime"
              tone={eff === 'remote' ? 'success' : 'danger'}
              label={RUNTIME_LABELS[eff] ?? eff}
            />
          </HelpTip>
        );
      },
    },
    {
      key: 'enabled',
      title: '状态',
      width: 120,
      render: (row) =>
        row.enabled ? (
          <StatusTag status="enabled" tone="success" label="上线中" />
        ) : (
          <HelpTip tip={row.reason || '未填写下线原因'}>
            <StatusTag status="disabled" tone="danger" label="已下线" />
          </HelpTip>
        ),
    },
    {
      key: 'updated',
      title: '最后修改',
      width: 180,
      render: (row) =>
        row.updatedAt ? (
          <div className="flex flex-col text-xs">
            <span>{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
            <span className="text-[12px] text-muted-foreground">{row.updatedBy ?? '-'}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">从未调整</span>
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 120,
      render: (row) => {
        /*
         * 与其它表的行内动作保持一致：ghost 小按钮 + 危险动作用红字。
         * 之前每行一颗实心红按钮，16 行下来整页最抢眼的是「下线」，
         * 反而看不出真正的状态列。
         */
        const button = (
          <ActionButton
            size="sm"
            variant="ghost"
            className={row.enabled ? 'text-danger-text hover:text-danger-text' : undefined}
            disabled={!writable || saving === row.capabilityId}
            onClick={() => {
              if (row.enabled) {
                setReason('');
                setOffline(row);
              } else {
                void bringOnline(row);
              }
            }}
          >
            {saving === row.capabilityId ? '处理中…' : row.enabled ? '下线' : '上线'}
          </ActionButton>
        );
        // 无写权限时把「为什么点不动」说清楚，不留一个灰按钮
        return writable ? button : <HelpTip tip="当前账号无 capability.write 权限">{button}</HelpTip>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="能力管控"
        description={
          writable
            ? '按能力单独上下线。下架后 C 端立刻停止收单并展示下线原因，生成接口返回 40005；不影响其它能力与模型线路。'
            : '当前账号只有 capability.read 权限，可查看能力状态但不能上下线。'
        }
      />

      <Panel
        title="能力清单"
        note={`显示 ${filteredRows.length} / ${rows.length} 项 ·「当前结论」由后台开关、逐能力路由与该模态的云端通道共同决定`}
      >
        <FilterBar>
          <ClearableField
            className="w-56"
            placeholder="能力名称 / ID / 模态"
            value={q}
            onChange={setQ}
          />
          <SelectField
            className="w-40"
            ariaLabel="按分组筛选"
            placeholder="全部分组"
            allowClear
            clearLabel="全部分组"
            value={group || undefined}
            onChange={(value) => setGroup(value ?? '')}
            options={groupOptions}
          />
          <SelectField
            className="w-40"
            ariaLabel="按运行结论筛选"
            placeholder="全部运行结论"
            allowClear
            clearLabel="全部运行结论"
            value={runtime}
            onChange={(value) =>
              setRuntime(value as 'remote' | 'disabled' | 'unavailable' | undefined)
            }
            options={[
              { value: 'remote', label: RUNTIME_LABELS.remote },
              { value: 'disabled', label: RUNTIME_LABELS.disabled },
              { value: 'unavailable', label: RUNTIME_LABELS.unavailable },
            ]}
          />
          <FilterActions>
            <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
              重置
            </ActionButton>
          </FilterActions>
          <AppliedFilters items={appliedFilters} onClearAll={resetFilters} />
        </FilterBar>

        {/*
          三态必须分家 (2026-10-23): 之前加载中是裸 <p>加载中…</p>、失败态用的却是
          AdminEmpty —— 同一块区域把「没连上」说成「没有数据」, 运营会以为能力清单被清空了。
          现在由表格统一处理：失败态带重试，空态说明「为什么空」。
        */}
        {error && rows.length > 0 && (
          <StaleError error={error} onRetry={() => void reload()} />
        )}
        <AdminDataTable<AdminCapabilityControl>
          rows={filteredRows}
          columns={columns}
          rowKey={(row) => row.capabilityId}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          minWidth={960}
          emptyText={
            rows.length === 0
              ? '没有可管控的能力'
              : '没有符合当前筛选的能力。'
          }
          emptyAction={
            rows.length > 0 && hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>

      <ConfirmAction
        open={!!offline}
        title={offline ? `下线「${offline.name}」` : ''}
        confirmText="确认下线"
        danger
        loading={saving === offline?.capabilityId}
        onCancel={() => setOffline(null)}
        onConfirm={() => void submitOffline()}
        description={
          <p className="text-xs text-muted-foreground">
            下架后用户在 C 端会看到下方填写的「下线原因」，同时该能力不可提交。此操作会写入审计日志。
          </p>
        }
        impact={['C 端停止提交该能力', '下线原因展示给用户', '写操作审计（含操作人）']}
        extra={
          <TextAreaField
            value={reason}
            onChange={setReason}
            rows={3}
            maxLength={200}
            showCount
            ariaLabel="下线原因"
            placeholder="例如：云端通道维护中，预计 2 小时恢复"
          />
        }
      />
    </>
  );
}
