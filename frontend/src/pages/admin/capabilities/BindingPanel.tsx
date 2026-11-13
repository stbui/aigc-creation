import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  Notice,
  NumberField,
  Panel,
  SelectField,
  StaleError,
  StatusTag,
  SwitchField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { adminCapabilityModelsApi } from '../../../lib/api';
import type {
  AdminCapabilityModelListView,
  AdminCapabilityModelCandidateView,
} from '../../../types/model';
import type { BindingDraft } from './types';
import { bindingCostHint, bindingIssue } from './utils';

function toDraft(row: AdminCapabilityModelListView['bindings'][number]): BindingDraft {
  return {
    channelModelId: row.channelModelId,
    enabled: row.enabled,
    priority: row.priority,
    weight: row.weight,
    modelKey: row.modelKey,
    displayName: row.displayName,
    channelName: row.channelName,
    channelEnabled: row.channelEnabled,
    modelEnabled: row.modelEnabled,
    priceConfigured: row.priceConfigured,
  };
}

/** 候选商品 → 绑定草稿；成本配置只做提示，不作为可执行门槛。 */
export function candidateToDraft(item: AdminCapabilityModelCandidateView): BindingDraft {
  return {
    channelModelId: item.channelModelId,
    enabled: true,
    priority: 0,
    weight: 100,
    modelKey: item.modelKey,
    displayName: item.displayName,
    channelName: item.channelName,
    channelEnabled: item.channelEnabled,
    modelEnabled: item.enabled,
    priceConfigured: item.priceConfigured,
  };
}

/** 候选池：展示失效绑定、维护优先级 / 权重，并支持只读模拟选路。 */
export function BindingPanel({
  capabilityId,
  data,
  loading,
  error,
  writable,
  onRetry,
  onChanged,
}: {
  capabilityId: string;
  data: AdminCapabilityModelListView | null;
  loading: boolean;
  error: string | null;
  writable: boolean;
  onRetry: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<BindingDraft[]>([]);
  const [candidateId, setCandidateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [simulate, setSimulate] = useState('');

  useEffect(() => {
    setDraft((data?.bindings ?? []).map(toDraft));
  }, [data]);

  // 模拟结果是已保存配置的快照；草稿一改，旧结果就不再代表当前页面内容。
  useEffect(() => {
    setSimulate('');
  }, [draft]);

  const candidates = useMemo(
    () =>
      (data?.candidates ?? []).filter(
        (item) => item.compatible && !draft.some((row) => row.channelModelId === item.channelModelId),
      ),
    [data, draft],
  );

  const candidateOptions = candidates.map((item) => {
    const modelName =
      item.displayName && item.displayName !== item.modelKey
        ? `${item.displayName} · ${item.modelKey}`
        : item.modelKey;
    return {
      value: item.channelModelId,
      label: `${modelName} · ${item.channelName || '未知渠道'}`,
    };
  });

  const addCandidate = (item: AdminCapabilityModelCandidateView) => {
    setDraft((current) => [...current, candidateToDraft(item)]);
    setCandidateId('');
  };

  const saveBindings = async () => {
    setSaving(true);
    try {
      await adminCapabilityModelsApi.replace(
        capabilityId,
        draft.map((row) => ({
          channelModelId: row.channelModelId,
          enabled: row.enabled,
          priority: row.priority,
          weight: row.weight,
        })),
      );
      toast.success('绑定已保存。请模拟选路确认命中线路。');
      await onRetry();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const pruneInvalid = async () => {
    const count = data?.invalidCount ?? 0;
    if (count === 0) return;
    const confirmed = await confirm({
      title: `清理 ${count} 条失效绑定？`,
      description:
        '只清理当前能力下指向已删除或不存在的商品的绑定；有效绑定、能力与售价不会改变。能力定义已失效的记录需使用页面顶部的「清理全部失效绑定」。',
      confirmText: '清理当前能力失效项',
      danger: true,
    });
    if (confirmed === null) return;
    setPruning(true);
    try {
      const result = await adminCapabilityModelsApi.pruneInvalid(capabilityId);
      toast.success(`已清理 ${result.removed} 条失效绑定，可继续保存其它绑定。`);
      await onRetry();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理失败');
    } finally {
      setPruning(false);
    }
  };

  const runSimulate = async () => {
    try {
      const result = (await adminCapabilityModelsApi.simulate(capabilityId, {})) as {
        selectedModelKey?: string;
        selectedChannelModelId?: string;
        reason?: string;
      };
      setSimulate(
        result.selectedChannelModelId
          ? `已保存配置命中 ${result.selectedModelKey || '可用商品'}`
          : result.reason || '当前没有可参与选路的商品',
      );
    } catch (error) {
      setSimulate(error instanceof Error ? error.message : '模拟失败');
    }
  };

  const columns: Array<AdminColumn<BindingDraft>> = [
    {
      key: 'model',
      title: '商品',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">
            {row.displayName || row.modelKey}
          </div>
          {row.displayName && row.displayName !== row.modelKey && (
            <div className="truncate font-mono text-[12px] text-muted-foreground">
              {row.modelKey}
            </div>
          )}
        </div>
      ),
    },
    { key: 'channel', title: '渠道', width: 144, render: (row) => row.channelName || '—' },
    {
      key: 'status',
      title: '状态',
      width: 112,
      render: (row) => {
        const issue = bindingIssue(row);
        const costHint = bindingCostHint(row);
        return (
          <div className="flex flex-col items-start gap-1">
            {issue === null ? (
              <StatusTag status="enabled" tone="success" label="配置可用" />
            ) : (
              <StatusTag status="disabled" tone="warn" label={issue} />
            )}
            {costHint && (
              <span className="text-xs leading-4 text-muted-foreground">{costHint}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'priority',
      title: '优先级',
      width: 88,
      render: (row) => (
        <NumberField
          ariaLabel={`${row.modelKey} 优先级`}
          value={row.priority}
          onChange={(value) =>
            setDraft((current) =>
              current.map((item) =>
                item.channelModelId === row.channelModelId ? { ...item, priority: Number(value) || 0 } : item,
              ),
            )
          }
        />
      ),
    },
    {
      key: 'weight',
      title: '权重',
      width: 88,
      render: (row) => (
        <NumberField
          ariaLabel={`${row.modelKey} 权重`}
          value={row.weight}
          onChange={(value) =>
            setDraft((current) =>
              current.map((item) =>
                item.channelModelId === row.channelModelId ? { ...item, weight: Number(value) || 1 } : item,
              ),
            )
          }
        />
      ),
    },
    {
      key: 'enabled',
      title: '参与选路',
      width: 88,
      render: (row) => (
        <SwitchField
          ariaLabel={`${row.modelKey} 参与选路`}
          checked={row.enabled}
          onChange={(checked) =>
            setDraft((current) =>
              current.map((item) =>
                item.channelModelId === row.channelModelId ? { ...item, enabled: checked } : item,
              ),
            )
          }
        />
      ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 80,
      render: (row) => (
        <ActionButton
          variant="ghost"
          size="sm"
          icon={Trash2}
          disabled={!writable}
          onClick={() =>
            setDraft((current) =>
              current.filter((item) => item.channelModelId !== row.channelModelId),
            )
          }
        >
          移除
        </ActionButton>
      ),
    },
  ];

  return (
    <Panel
      title="承接商品"
      extra={
        <div className="flex items-center gap-2">
          <ActionButton variant="secondary" size="xs" onClick={() => void runSimulate()}>
            模拟选路
          </ActionButton>
          <ActionButton
            variant="default"
            size="xs"
            disabled={!writable || saving}
            onClick={() => void saveBindings()}
          >
            {saving ? '保存中…' : '保存绑定'}
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          选路先按模型分组与健康分层筛选。同层内优先级越小越优先，再按权重分流。保存后请重新模拟选路。
        </p>
        {simulate && <Notice tone="info">{simulate}</Notice>}
        {error && <StaleError error={error} onRetry={onRetry} />}

        {(data?.invalidCount ?? 0) > 0 && (
          <Notice
            tone="warn"
            title={`失效绑定 ${data?.invalidCount ?? 0} 条`}
            className="mb-0"
          >
            <div className="flex flex-col gap-2">
              <div>
                这些绑定指向已删除或不存在的商品，已不参与选路。保存其它绑定不会自动删除，
                确认不再需要这条记录后再清理。
              </div>
              <div className="max-h-40 overflow-auto rounded border border-warn-soft bg-card">
                {(data?.invalidBindings ?? []).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 border-b border-border px-2 py-1.5 last:border-b-0"
                    title={`原始绑定 ID：${row.channelModelId}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-foreground">
                        {row.displayName || row.modelKey || '未知商品'}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[
                          row.modelKey ? `模型 ${row.modelKey}` : '',
                          row.channelName ? `供应商 ${row.channelName}` : '',
                          `原绑定 ${row.channelModelId}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-warn-text">{row.reason}</span>
                  </div>
                ))}
              </div>
              <ActionButton
                variant="secondary"
                size="xs"
                disabled={!writable || pruning}
                onClick={() => void pruneInvalid()}
                className="w-fit"
              >
                {pruning ? '清理中…' : '清理当前能力失效项'}
              </ActionButton>
            </div>
          </Notice>
        )}

        {writable && (
          <div className="flex flex-wrap items-end gap-2">
            <SelectField
              ariaLabel="添加候选商品"
              value={candidateId || undefined}
              onChange={(value) => setCandidateId(value ?? '')}
              options={candidateOptions}
              clearLabel="选择兼容商品"
              allowClear
              className="w-96"
            />
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Plus}
              disabled={!candidateId}
              onClick={() => {
                const item = candidates.find((entry) => entry.channelModelId === candidateId);
                if (item) addCandidate(item);
              }}
            >
              添加
            </ActionButton>
          </div>
        )}

        <AdminDataTable<BindingDraft>
          rows={draft}
          columns={columns}
          rowKey={(row) => row.channelModelId}
          loading={loading}
          emptyText="还没有绑定任何商品"
          minWidth={780}
        />
      </div>
    </Panel>
  );
}
