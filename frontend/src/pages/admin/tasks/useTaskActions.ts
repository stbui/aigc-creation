import { useCallback, useRef, useState } from 'react';
import type { BatchSummary } from '../../../types/api';
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

const BATCH_TITLES: Record<TaskActionKind, string> = {
  retry: '批量重试结果',
  cancel: '批量终止结果',
  delete: '批量删除结果',
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
  const [batchSummary, setBatchSummary] = useState<BatchSummary<unknown> | null>(null);
  const [batchTitle, setBatchTitle] = useState('');
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
        setBatchTitle(BATCH_TITLES[kind]);
        setBatchSummary(summary);
        setBatchKind(null);
        onSelectionChange([]);
        reload();
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
    batchSummary,
    batchTitle,
    openConfirm,
    openBatch,
    runConfirm,
    runBatch,
    closeConfirm: () => setConfirm(null),
    closeBatch: () => setBatchKind(null),
    closeBatchSummary: () => setBatchSummary(null),
  };
}
