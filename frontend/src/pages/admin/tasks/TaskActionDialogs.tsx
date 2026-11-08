import { ConfirmDialog } from '~/admin-ui/primitives';
import { TaskDeleteDialog } from './TaskDeleteDialog';
import type { AdminTaskRow, TaskActionKind } from './types';
import { shortId } from './utils';

interface TaskActionDialogsProps {
  confirm: { kind: TaskActionKind; task: AdminTaskRow } | null;
  batchKind: TaskActionKind | null;
  selectedCount: number;
  busy: boolean;
  onCloseConfirm: () => void;
  onCloseBatch: () => void;
  onConfirm: () => Promise<void>;
  onRunBatch: (kind: TaskActionKind) => Promise<void>;
}

/** 任务单条动作与批量动作的确认弹框。 */
export function TaskActionDialogs({
  confirm,
  batchKind,
  selectedCount,
  busy,
  onCloseConfirm,
  onCloseBatch,
  onConfirm,
  onRunBatch,
}: TaskActionDialogsProps) {
  return (
    <>
      {confirm?.kind === 'delete' && (
        <TaskDeleteDialog
          open
          title="删除任务"
          target={`任务 ${shortId(confirm.task.id)} · ${confirm.task.capabilityName}`}
          loading={busy}
          onCancel={onCloseConfirm}
          onConfirm={() => void onConfirm()}
        />
      )}

      {confirm && confirm.kind !== 'delete' && (
        <ConfirmDialog
          open
          title={confirm.kind === 'retry' ? '重试失败任务' : '终止任务'}
          confirmText={confirm.kind === 'retry' ? '新建任务并重试' : '确认终止'}
          danger={confirm.kind === 'cancel'}
          loading={busy}
          onCancel={onCloseConfirm}
          onConfirm={() => void onConfirm()}
          description={
            confirm.kind === 'retry' ? (
              <>
                <p>
                  将用<b>原任务的参数与输入素材</b>新建一个任务并重新执行，原任务与其记录保留。
                </p>
                <p className="mt-1 text-muted-foreground">
                  任务 {shortId(confirm.task.id)} · {confirm.task.capabilityName}
                </p>
              </>
            ) : (
              <>
                <p>
                  任务将被置为失败，用户端立即看到失败状态。
                  <b>已发出的模型调用仍会跑完并计费</b>，但产出图不会再入库。
                </p>
                <p className="mt-1 text-muted-foreground">
                  任务 {shortId(confirm.task.id)} · {confirm.task.capabilityName}
                </p>
              </>
            )
          }
          impact={
            confirm.kind === 'retry'
              ? ['新增 1 个任务，原任务记录不变', '将真实消耗模型额度', '用户端历史页会出现一条新记录']
              : [
                  '任务状态变为失败，用户端立即可见',
                  '若产出已入库，该产出图不再展示',
                  '不可撤销（需重新发起生成）',
                ]
          }
        />
      )}

      {/* 批量重试 / 终止 / 删除：一次作用于 N 条，更需要理由留痕。 */}
      {batchKind === 'delete' && (
        <TaskDeleteDialog
          open
          title="批量删除任务"
          target={`已选择 ${selectedCount} 个任务。`}
          note="只删除已结束且仍存在的任务；排队中、执行中或已不存在的任务会自动跳过。"
          loading={busy}
          onCancel={onCloseBatch}
          onConfirm={() => void onRunBatch(batchKind)}
        />
      )}

      {batchKind && batchKind !== 'delete' && (
        <ConfirmDialog
          open
          title={
            batchKind === 'retry'
              ? `批量重试 ${selectedCount} 个任务`
              : `批量终止 ${selectedCount} 个任务`
          }
          confirmText={batchKind === 'retry' ? '确认重试' : '确认终止'}
          danger={batchKind === 'cancel'}
          loading={busy}
          onCancel={onCloseBatch}
          onConfirm={() => void onRunBatch(batchKind)}
          description={
            batchKind === 'retry' ? (
              <>
                <p>
                  将为每个<b>失败</b>任务用原参数新建一个任务。非失败状态的行会被跳过，
                  原因会在结果里逐条列出。
                </p>
                <p className="mt-1 text-muted-foreground">
                  重试会真实消耗模型额度，批量执行请先确认数量。
                </p>
              </>
            ) : (
              <>
                <p>
                  选中的<b>等待中 / 执行中</b>任务会被置为失败并立即对用户可见。
                  已完成的或已失败的行会被跳过。
                </p>
                <p className="mt-1 text-muted-foreground">
                  已发出的模型调用仍会跑完并计费，但产出图不再入库。
                </p>
              </>
            )
          }
          impact={
            batchKind === 'retry'
              ? [`最多新增 ${selectedCount} 个任务`, '每个任务将真实消耗模型额度']
              : ['目标任务状态变为失败', '不可撤销（需重新发起生成）']
          }
        />
      )}
    </>
  );
}
