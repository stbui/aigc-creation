import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react';

import {
  ActionButton,
  Drawer,
  EmptyState,
  IconButton,
  Notice,
  StatusTag,
} from '~/admin-ui/primitives';
import { moveOrderItem, orderChanged, type OrderItem } from '~/lib/channelOrder';
import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
} from '../../../types/payment';
import { adminPaymentProvidersApi } from './api';
import {
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import {
  draftFromInstance,
  draftToConfigUpdate,
  instanceDraftChanged,
  PaymentsProviderInstanceEditor,
  type InstanceDraft,
} from './PaymentsProviderInstanceEditor';
import { PAYMENT_METHOD_LABELS, PAYMENT_PROVIDER_STATE_META } from './constants';
import {
  instanceLabel,
  instanceState,
  providerWithInstances,
} from './utils';

function sortedInstances(
  instances: AdminPaymentProviderInstanceView[],
): AdminPaymentProviderInstanceView[] {
  return [...instances].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.instanceId.localeCompare(b.instanceId),
  );
}

function moveInstances(
  instances: AdminPaymentProviderInstanceView[],
  id: string,
  target: number,
): AdminPaymentProviderInstanceView[] {
  const entries = instances.map((instance) => ({
    id: instance.instanceId,
    instance,
  }));
  const next = moveOrderItem(entries, id, target);
  if (next === entries) return instances;
  return next.map((entry, index) => ({
    ...entry.instance,
    sortOrder: (index + 1) * 10,
  }));
}

/**
 * 收款通道管理抽屉。
 *
 * 列表与编辑共用同一份本地 provider 投影：新建 / 保存 / 排序成功后先用接口返回
 * 的实例数据刷新抽屉，父级渠道卡片再异步重取列表。这样连续编辑多个实例时，
 * 抽屉不会因为父级重新渲染而丢失当前选择。
 */
export function PaymentsProviderInstancesDrawer({
  open,
  provider: initialProvider,
  writable,
  onClose,
  onChanged,
}: {
  open: boolean;
  provider: AdminPaymentProviderView;
  writable: boolean;
  onClose: () => void;
  onChanged: (provider: AdminPaymentProviderView) => void;
}) {
  const toast = useToast();
  const initialInstances = useMemo(
    () => sortedInstances(initialProvider.instances),
    [initialProvider],
  );
  const initialSelected = initialInstances[0] ?? null;
  const initialDraft = initialSelected
    ? draftFromInstance(initialProvider, initialSelected)
    : null;

  const [currentProvider, setCurrentProvider] = useState(initialProvider);
  const [instances, setInstances] =
    useState<AdminPaymentProviderInstanceView[]>(initialInstances);
  const [originalIds, setOriginalIds] = useState<string[]>(
    initialInstances.map((instance) => instance.instanceId),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelected?.instanceId ?? null,
  );
  const [draft, setDraft] = useState<InstanceDraft | null>(initialDraft);
  const [baseline, setBaseline] = useState<InstanceDraft | null>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sorting, setSorting] = useState(false);
  const draggedId = useRef<string | null>(null);
  const pendingDraftDiscard = useRef<() => void>(() => {});

  const busy = saving || creating || sorting;
  const selectedInstance =
    instances.find((instance) => instance.instanceId === selectedId) ?? null;
  const draftDirty = Boolean(
    draft && baseline && instanceDraftChanged(draft, baseline),
  );
  const orderItems: OrderItem[] = useMemo(
    () =>
      instances.map((instance) => ({
        id: instance.instanceId,
        name: instanceLabel(instance),
        enabled: instance.enabled,
      })),
    [instances],
  );
  const orderDirty = useMemo(
    () => orderChanged(orderItems, originalIds),
    [orderItems, originalIds],
  );

  useUnsavedGuard((draftDirty || orderDirty) && !busy);

  const closeNow = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  const requestClose = useDiscardConfirm(draftDirty || orderDirty, closeNow);

  const confirmDraftDiscard = useDiscardConfirm(draftDirty, () => {
    const action = pendingDraftDiscard.current;
    pendingDraftDiscard.current = () => {};
    action();
  });

  const runAfterDraftDiscard = useCallback(
    (action: () => void) => {
      pendingDraftDiscard.current = action;
      confirmDraftDiscard();
    },
    [confirmDraftDiscard],
  );

  const selectInstance = useCallback(
    (instanceId: string) => {
      const instance = instances.find((item) => item.instanceId === instanceId);
      if (!instance) return;
      const nextDraft = draftFromInstance(currentProvider, instance);
      setSelectedId(instanceId);
      setDraft(nextDraft);
      setBaseline(nextDraft);
    },
    [currentProvider, instances],
  );

  const requestSelect = (instanceId: string) => {
    if (instanceId === selectedId) return;
    runAfterDraftDiscard(() => selectInstance(instanceId));
  };

  const createInstanceNow = async () => {
    if (!writable || busy) return;
    if (orderDirty) {
      toast.error('请先保存通道排序，再添加通道');
      return;
    }
    setCreating(true);
    try {
      const { instance } = await adminPaymentProvidersApi.createInstance(
        currentProvider.id,
        {},
      );
      const nextInstances = sortedInstances([...instances, instance]);
      const nextProvider = providerWithInstances(currentProvider, nextInstances);
      const nextDraft = draftFromInstance(nextProvider, instance);
      setCurrentProvider(nextProvider);
      setInstances(nextInstances);
      setOriginalIds(nextInstances.map((item) => item.instanceId));
      setSelectedId(instance.instanceId);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      toast.success('通道已添加，当前默认停用');
      onChanged(nextProvider);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加通道失败');
    } finally {
      setCreating(false);
    }
  };

  const requestCreate = () => {
    if (!writable || busy) return;
    if (orderDirty) {
      toast.error('请先保存通道排序，再添加通道');
      return;
    }
    runAfterDraftDiscard(() => void createInstanceNow());
  };

  const saveInstance = async () => {
    if (!writable || busy || !selectedInstance || !draft) return;
    if (orderDirty) {
      toast.error('请先保存通道排序，再保存通道配置');
      return;
    }
    setSaving(true);
    try {
      const result = await adminPaymentProvidersApi.saveInstance(
        currentProvider.id,
        selectedInstance.instanceId,
        draftToConfigUpdate(draft),
      );
      const nextInstances = sortedInstances(result.provider.instances);
      const saved = nextInstances.find(
        (instance) => instance.instanceId === selectedInstance.instanceId,
      );
      if (!saved) throw new Error('保存后未找到当前通道');
      const nextDraft = draftFromInstance(result.provider, saved);
      setCurrentProvider(result.provider);
      setInstances(nextInstances);
      setOriginalIds(nextInstances.map((instance) => instance.instanceId));
      setDraft(nextDraft);
      setBaseline(nextDraft);
      toast.success(result.unchanged ? '通道配置未变化' : '通道配置已保存');
      onChanged(result.provider);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存通道失败');
    } finally {
      setSaving(false);
    }
  };

  const move = (id: string, target: number) => {
    if (!writable || busy) return;
    const next = moveInstances(instances, id, target);
    if (next === instances) return;
    setInstances(next);
    setCurrentProvider(providerWithInstances(currentProvider, next));
  };

  const saveOrder = async () => {
    if (!writable || busy || !orderDirty) return;
    if (draftDirty) {
      toast.error('请先保存通道配置，再保存排序');
      return;
    }
    setSorting(true);
    try {
      const nextProvider = await adminPaymentProvidersApi.reorderInstances(
        currentProvider.id,
        instances.map((instance) => instance.instanceId),
      );
      const nextInstances = sortedInstances(nextProvider.instances);
      const nextSelected = nextInstances.find(
        (instance) => instance.instanceId === selectedId,
      );
      setCurrentProvider(nextProvider);
      setInstances(nextInstances);
      setOriginalIds(nextInstances.map((instance) => instance.instanceId));
      if (nextSelected) {
        const nextDraft = draftFromInstance(nextProvider, nextSelected);
        setDraft(nextDraft);
        setBaseline(nextDraft);
      }
      toast.success('通道排序已保存');
      onChanged(nextProvider);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存通道排序失败');
    } finally {
      setSorting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={`${initialProvider.name} · 收款通道`}
      description="同一收款来源可添加多个通道；客户付款时只会在当前来源内选择可用通道，不会跨来源回退。"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-[12px] text-muted-foreground">
            {instances.length} 条通道 · {instances.filter((item) => item.enabled).length} 条已启用
          </span>
          <ActionButton onClick={requestClose} disabled={busy}>
            关闭
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="m-0 text-[13px] font-semibold text-foreground">通道列表</h3>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              拖动或使用上下箭头调整顺序；系统会按此顺序轮询可用通道。
            </p>
          </div>
          <ActionButton
            variant="outline"
            icon={Plus}
            onClick={requestCreate}
            disabled={!writable || busy}
          >
            {creating ? '添加中…' : '添加通道'}
          </ActionButton>
        </div>

        {orderDirty && (
          <Notice tone="warn" className="mb-0">
            <div className="flex items-center justify-between gap-3">
              <span>通道顺序尚未保存。</span>
              <ActionButton
                size="xs"
                onClick={() => void saveOrder()}
                disabled={!writable || busy || draftDirty}
                ariaLabel={
                  draftDirty ? '请先保存当前通道配置，再保存排序' : '保存通道排序'
                }
              >
                {sorting ? '保存中…' : '保存排序'}
              </ActionButton>
            </div>
          </Notice>
        )}

        {instances.length === 0 ? (
          <EmptyState
            title="该收款来源还没有通道"
            description={writable ? '添加一条通道并补齐接入参数后即可启用。' : undefined}
          />
        ) : (
          <div className="flex flex-col gap-2" role="list" aria-label="收款通道">
            {instances.map((instance, index) => {
              const state = instanceState(instance);
              const meta = PAYMENT_PROVIDER_STATE_META[state];
              const selected = instance.instanceId === selectedId;
              return (
                <div
                  key={instance.instanceId}
                  role="listitem"
                  draggable={writable && !busy}
                  onDragStart={(event) => {
                    if (!writable || busy) return;
                    event.dataTransfer.setData('text/plain', instance.instanceId);
                    draggedId.current = instance.instanceId;
                  }}
                  onDragEnd={() => {
                    draggedId.current = null;
                  }}
                  onDragOver={(event) => {
                    if (writable && !busy) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = draggedId.current;
                    if (source) move(source, index);
                    draggedId.current = null;
                  }}
                  aria-current={selected ? 'true' : undefined}
                  className={[
                    'flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 transition-colors',
                    selected
                      ? 'border-primary/35 bg-primary/5'
                      : 'border-border hover:border-primary/20',
                  ].join(' ')}
                >
                  <GripVertical
                    aria-hidden
                    className="shrink-0 cursor-grab text-muted-foreground"
                    size={15}
                  />
                  <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => requestSelect(instance.instanceId)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {instanceLabel(instance)}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                        <span>
                          {instance.paymentMethods
                            .map((method) => PAYMENT_METHOD_LABELS[method])
                            .join(' / ')}
                        </span>
                        {instance.version == null && <span>配置尚未保存</span>}
                      </span>
                    </span>
                    <StatusTag
                      status={state}
                      tone={meta.tone}
                      label={meta.label}
                      showDot={state === 'usable'}
                    />
                  </button>
                  <IconButton
                    icon={ArrowUp}
                    size="sm"
                    label={`上移 ${instanceLabel(instance)}`}
                    disabled={!writable || busy || index === 0}
                    onClick={() => move(instance.instanceId, index - 1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="sm"
                    label={`下移 ${instanceLabel(instance)}`}
                    disabled={!writable || busy || index === instances.length - 1}
                    onClick={() => move(instance.instanceId, index + 1)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {selectedInstance && draft && baseline ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <PaymentsProviderInstanceEditor
              provider={currentProvider}
              instance={selectedInstance}
              draft={draft}
              baseline={baseline}
              writable={writable}
              saving={saving}
              onDraftChange={setDraft}
              onSave={() => void saveInstance()}
            />
          </div>
        ) : (
          !busy &&
          instances.length > 0 && (
            <EmptyState title="选择上方通道进行配置" />
          )
        )}
      </div>
    </Drawer>
  );
}
