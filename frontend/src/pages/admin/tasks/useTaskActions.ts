import { useCallback, useRef, useState } from 'react';
import { adminTasksApi } from './api';
import { useToast } from './hooks';
import type { AdminTaskRow, TaskActionKind } from './types';
import { shortId } from './utils';

interface UseTaskActionsOptions {
  reload: () => void;
  onDeleted: () => void;
  selected: string[];
  onSelectionChange: (keys: string[]) => void;
}

const BATCH_LABELS: Record<Exclude<TaskActionKind, 'delete'>, string> = {
  retry: '重试',
  cancel: '终止',
};

/** 任务单条与批量写操作、确认框状态和提交互斥。 */
export function useTaskActions({
  reload,
  onDeleted,
  selected,
  onSelectionChange,
}: UseTaskActionsOptions) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: TaskActionKind; task: AdminTaskRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchKind, setBatchKind] = useState<TaskActionKind | null>(null);
  const busyRef = useRef(false);

  const begin = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }, []);

  const finish = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
  }, []);

  const openConfirm = useCallback((kind: TaskActionKind, task: AdminTaskRow) => {
    setConfirm({ kind, task });
  }, []);

  const openBatch = useCallback(
    (kind: TaskActionKind) => {
      if (selected.length === 0 || busyRef.current) return;
      setBatchKind(kind);
    },
    [selected.length],
  );

  /** 三个动作都要刷新列表：重试新增行，终止改状态，删除移除行。 */
  const runConfirm = useCallback(async () => {
    if (!confirm || !begin()) return;
    try {
      if (confirm.kind === 'retry') {
        const result = await adminTasksApi.retry(confirm.task.id);
        toast.success(`已用原参数新建任务 ${shortId(result.taskId)}`);
      } else if (confirm.kind === 'cancel') {
        await adminTasksApi.cancel(confirm.task.id);
        toast.success('任务已终止');
      } else {
        await adminTasksApi.remove(confirm.task.id);
        toast.success('任务及其产出已删除');
      }
      setConfirm(null);
      onDeleted();
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      finish();
    }
  }, [begin, confirm, finish, onDeleted, reload, toast]);

  const runBatch = useCallback(
    async (kind: TaskActionKind) => {
      if (selected.length === 0 || !begin()) return;
      try {
        const summary = await adminTasksApi.batch(selected, kind);
        setBatchKind(null);
        onSelectionChange([]);
        reload();
        const label = kind === 'delete' ? '删除' : BATCH_LABELS[kind];
        if (summary.failed > 0) {
          toast.warning(
            `批量${label}完成：成功 ${summary.succeeded} 个，失败 ${summary.failed} 个`,
          );
        } else {
          toast.success(`批量${label}完成：成功 ${summary.succeeded} 个`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '批量操作失败');
      } finally {
        finish();
      }
    },
    [begin, finish, onSelectionChange, reload, selected, toast],
  );

  return {
    confirm,
    busy,
    batchKind,
    openConfirm,
    openBatch,
    runConfirm,
    runBatch,
    closeConfirm: () => setConfirm(null),
    closeBatch: () => setBatchKind(null),
  };
}
