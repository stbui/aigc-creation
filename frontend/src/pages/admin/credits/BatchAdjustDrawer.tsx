import { useMemo, useState } from 'react';
import {
  ActionButton,
  AdminDataTable,
  DetailSection,
  Drawer,
  FormField,
  Notice,
  StatusTag,
  TextAreaField,
  TextField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { adminCreditsApi } from './api';
import { useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import type { BatchAdjustItem, BatchAdjustResult, BatchAdjustRow } from './constants';

/**
 * 批量调整。
 *
 * 输入格式是「每行 用户ID,变动量」而不是动态表单:
 * 运营手里通常是从表格里复制出来的一批 id, 粘进 textarea 比逐行点「添加」
 * 快一个数量级, 也避免了 N 个受控输入各自校验。
 */
export function BatchAdjustDrawer({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  /** 整批共用的调整备注。可选；留空时后端为每条流水生成系统说明 */
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchAdjustResult | null>(null);
  /**
   * 批次幂等键。打开抽屉时生成一次，重试时原样复用 ——
   * 否则一次超时重试会把同一批积分发两遍。
   */
  const [batchKey, setBatchKey] = useState(() => newBatchKey());
  const dirty = !result && Boolean(text.trim() || reason.trim());
  useUnsavedGuard(open && dirty);

  /** 解析结果与错误行分开返回: 有错行时仍展示能解析的部分, 便于边改边看 */
  const parsed = useMemo(() => {
    const items: BatchAdjustItem[] = [];
    const errors: string[] = [];
    text
      .split('\n')
      .map((l) => l.trim())
      .forEach((line, i) => {
        if (!line) return;
        // 逗号兼容中英文, 从表格粘贴过来的常是中文逗号
        const parts = line.split(/[,，]/).map((p) => p.trim());
        if (parts.length < 2) {
          errors.push(`第 ${i + 1} 行：缺少变动量`);
          return;
        }
        const delta = Number(parts[1]);
        if (!parts[0]) errors.push(`第 ${i + 1} 行：用户 ID 为空`);
        else if (!Number.isInteger(delta) || delta === 0) {
          errors.push(`第 ${i + 1} 行：变动量必须是非零整数`);
        } else {
          items.push({ userId: parts[0], delta });
        }
      });
    if (items.length > 100) errors.push(`共 ${items.length} 条，单次最多 100 条`);
    return { items, errors };
  }, [text]);

  const close = () => {
    if (busy) return;
    setText('');
    setReason('');
    setResult(null);
    onClose();
  };
  const requestClose = useDiscardConfirm(open && dirty, close);
  const done = () => {
    setText('');
    setReason('');
    setResult(null);
    // 本批已完成，下一批必须换新键 —— 复用会让下一批全被判定为重试
    setBatchKey(newBatchKey());
    onDone();
  };

  const submit = async () => {
    if (parsed.items.length === 0) {
      toast.warning('没有可提交的有效行');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.batchAdjust({
        items: parsed.items,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        idempotencyKey: batchKey,
      });
      setResult(r);
      if (r.failed === 0) toast.success(`已调整 ${r.succeeded} 条`);
      else toast.warning(`成功 ${r.succeeded} 条，失败 ${r.failed} 条`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量调整失败');
    } finally {
      setBusy(false);
    }
  };

  const resultColumns: Array<AdminColumn<BatchAdjustRow>> = [
    {
      key: 'userId',
      title: '用户 ID',
      render: (row) => (
        <code className="font-mono text-[12px] text-muted-foreground">{row.userId}</code>
      ),
    },
    {
      key: 'ok',
      title: '结果',
      width: 90,
      render: (row) =>
        row.success ? (
          <StatusTag status="succeeded" label="成功" tone="success" />
        ) : (
          <StatusTag status="failed" label="失败" tone="danger" />
        ),
    },
    {
      key: 'msg',
      title: '说明',
      render: (row) => (
        <span className="text-[12px] text-muted-foreground">
          {row.success
            ? row.idempotentHit
              ? `余额 ${row.balance} · 重试命中，未重复发放`
              : `余额 ${row.balance}`
            : (row.message ?? '未知原因')}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      title="批量调整积分"
      width={680}
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      footer={
        <>
          <ActionButton variant="secondary" onClick={requestClose} disabled={busy}>
            {result ? '关闭' : '取消'}
          </ActionButton>
          {result ? (
            <ActionButton variant="default" onClick={done}>
              完成
            </ActionButton>
          ) : (
            <ActionButton
              variant="default"
              onClick={() => void submit()}
              disabled={busy || parsed.items.length === 0}
            >
              {busy ? '提交中…' : `提交 ${parsed.items.length} 条`}
            </ActionButton>
          )}
        </>
      }
    >
      {result ? (
        <DetailSection
          title="执行结果"
          note={`成功 ${result.succeeded} · 失败 ${result.failed}${
            result.idempotentHits > 0 ? ` · 重试命中 ${result.idempotentHits}` : ''
          }`}
        >
          <AdminDataTable
            rows={result.results}
            columns={resultColumns}
            rowKey={(row) => row.userId}
            density="compact"
            emptyText="没有结果"
          />
        </DetailSection>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField
            label="调整清单"
            hint="正数增加、负数扣减，单次最多 100 条；逐条独立执行，一条失败不影响其余"
          >
            <TextAreaField
              value={text}
              onChange={setText}
              rows={8}
              placeholder={'每行一条：用户ID,变动量\n如：\ncuid_abc,100\ncuid_def,-50'}
              ariaLabel="调整清单"
            />
          </FormField>

          {parsed.errors.length > 0 && (
            <Notice tone="warn">
              {parsed.errors.slice(0, 5).join('；')}
              {parsed.errors.length > 5 ? ` …共 ${parsed.errors.length} 处问题` : ''}
            </Notice>
          )}

          <FormField
            label="调整备注（可选）"
            hint="本批共用；留空时由系统生成说明。某一条需要不同说明时，可在该行第 3 列单独写。"
          >
            <TextField
              value={reason}
              onChange={setReason}
              placeholder="如：双十一活动补偿"
              ariaLabel="调整备注（可选）"
            />
          </FormField>

          <Notice tone="warn">
            提交后立即改变用户可用余额。同一批重复提交会被幂等键拦住，不会二次发放。
          </Notice>
        </div>
      )}
    </Drawer>
  );
}

/** 批次幂等键：时间戳 + 随机串，一次打开抽屉生成一次 */
function newBatchKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
