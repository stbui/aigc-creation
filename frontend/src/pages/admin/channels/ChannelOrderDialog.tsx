import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { adminChannelsApi } from './api';
import {
  ActionButton,
  EmptyState,
  IconButton,
  ModalDialog,
  NumberField,
  SelectField,
} from '~/admin-ui/primitives';
import { useToast } from './hooks';
import { moveOrderItem, orderChanged, type OrderItem } from './utils';
import type { ChannelOrderItemView } from '../../../types/model';

/**
 * 排序弹窗（渠道之间 / 渠道内模型之间）。
 *
 * ## 两条硬规则
 *
 *   1. **保存必须带 `expectedIds`** —— 它是「我读到的原始顺序」。后端比对
 *      当前库里的顺序，不一致就整单拒绝（HTTP 409）。没有它，两个运营
 *      同时排序会互相静默覆盖。
 *   2. **列表含全部条目** —— 不受任何筛选与分页影响。排序是全局的，
 *      在筛选后的子集里排序会得到「保存后顺序乱了」的结果。
 *
 * 交互给了三种等价手段：拖拽、上移/下移按钮、输入目标位置。
 * 拖拽最顺手但最容易出错（拖到一半没落位），按钮最稳，位置输入最快。
 * 三者操作的是同一份 state，不存在「拖完又要点按钮」的双份状态。
 */
export function ChannelOrderDialog({
  open,
  /** 空串 = 排渠道；有值 = 排该渠道下的模型 */
  channelId,
  channelName,
  onClose,
  onSaved,
}: {
  open: boolean;
  channelId?: string;
  channelName?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();

  const [items, setItems] = useState<OrderItem[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const [targetPosition, setTargetPosition] = useState<number | undefined>(undefined);

  const draggedId = useRef<string | null>(null);
  /** 防重复提交：并发两次保存会发两次同样的 CAS 请求 */
  const pending = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list: ChannelOrderItemView[] = channelId
        ? (await adminChannelsApi.modelOrder(channelId)).items
        : (await adminChannelsApi.order()).items;
      setItems(list);
      setOriginalIds(list.map((item) => item.id));
      setTargetId(undefined);
      setTargetPosition(undefined);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '读取排序失败');
      setItems([]);
      setOriginalIds([]);
    } finally {
      setLoading(false);
    }
  }, [channelId, toast]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const changed = useMemo(() => orderChanged(items, originalIds), [items, originalIds]);

  const move = (id: string, target: number) => {
    setItems((current) => moveOrderItem(current, id, target));
  };

  const save = async () => {
    if (pending.current || !changed || saving) return;
    pending.current = true;
    setSaving(true);
    try {
      const ids = items.map((item) => item.id);
      if (channelId) {
        await adminChannelsApi.saveModelOrder(channelId, ids, originalIds);
      } else {
        await adminChannelsApi.saveOrder(ids, originalIds);
      }
      toast.success('排序已保存');
      try {
        await onSaved();
      } catch {
        toast.error('排序已保存，但列表刷新失败，请手动刷新');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存排序失败');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const options = useMemo(
    () =>
      items.map((item, index) => ({
        value: item.id,
        label: `${index + 1}. ${item.name}${item.enabled ? '' : '（已停用）'}`,
      })),
    [items],
  );

  const positionInvalid =
    targetPosition === undefined ||
    !Number.isInteger(targetPosition) ||
    targetPosition < 1 ||
    targetPosition > items.length;

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving && !loading) onClose();
      }}
      width={640}
      title={channelId ? `自定义商品排序 · ${channelName ?? ''}` : '调整供应商顺序'}
      description="拖拽或用上下箭头调整顺序，也可输入目标位置。这里包含全部条目，不受列表筛选和分页影响。"
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving || loading}>
            取消
          </ActionButton>
          <ActionButton
            variant="default"
            size="sm"
            disabled={!changed || loading || saving}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : '保存排序'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <SelectField
              ariaLabel={channelId ? '选择要排序的商品' : '选择要排序的供应商'}
              value={targetId}
              onChange={(value) => {
                setTargetId(value);
                if (value) {
                  const index = items.findIndex((item) => item.id === value);
                  setTargetPosition(index >= 0 ? index + 1 : undefined);
                } else {
                  setTargetPosition(undefined);
                }
              }}
              options={options}
              placeholder={channelId ? '搜索并选择商品' : '搜索并选择供应商'}
              disabled={loading || saving || items.length === 0}
              className="w-full"
            />
          </div>
          <div className="w-24">
            <NumberField
              ariaLabel="目标位置"
              value={targetPosition}
              min={1}
              max={Math.max(1, items.length)}
              onChange={setTargetPosition}
              disabled={loading || saving || !targetId}
            />
          </div>
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={
              loading ||
              saving ||
              !targetId ||
              positionInvalid ||
              targetPosition === items.findIndex((item) => item.id === targetId) + 1
            }
            onClick={() => {
              if (targetId && !positionInvalid && targetPosition !== undefined) {
                move(targetId, targetPosition - 1);
              }
            }}
          >
            移动到此位置
          </ActionButton>
        </div>

        {loading && items.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <EmptyState title="暂无可排序条目" />
        ) : (
          <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto" role="list">
            {items.map((item, index) => (
              <div
                key={item.id}
                role="listitem"
                draggable={!saving}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', item.id);
                  draggedId.current = item.id;
                }}
                onDragEnd={() => {
                  draggedId.current = null;
                }}
                onDragOver={(event) => {
                  if (!saving) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = draggedId.current;
                  if (!saving && source) move(source, index);
                  draggedId.current = null;
                }}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
              >
                <GripVertical aria-hidden className="shrink-0 cursor-grab text-muted-foreground" size={14} />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
                {!item.enabled && <span className="shrink-0 text-[12px] text-muted-foreground">已停用</span>}
                <IconButton
                  icon={ArrowUp}
                  size="sm"
                  label={`上移 ${item.name}`}
                  disabled={saving || index === 0}
                  onClick={() => move(item.id, index - 1)}
                />
                <IconButton
                  icon={ArrowDown}
                  size="sm"
                  label={`下移 ${item.name}`}
                  disabled={saving || index === items.length - 1}
                  onClick={() => move(item.id, index + 1)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
