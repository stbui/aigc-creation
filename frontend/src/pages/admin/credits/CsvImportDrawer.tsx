import { useMemo, useState } from 'react';
import {
  ActionButton,
  AdminDataTable,
  DetailSection,
  Drawer,
  FilePicker,
  FormField,
  Notice,
  Pagination,
  StatusTag,
  TextField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { IMPORT_PAGE_SIZE } from './constants';
import { adminCreditsApi } from './api';
import { useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import { signed } from './utils';
import type { CreditImportResult } from '../../../types/api';

/**
 * CSV 导入积分。
 *
 * ## 为什么单独做而不是复用「批量调整」
 *
 * 批量调整的输入是 `用户ID,变动量`, 而运营手里拿到的是财务/客服给的
 * **邮箱名单**（Excel 导出）。让运营先把邮箱查成 cuid 再粘贴, 是几百次
 * 手工查找, 且错一个 id 就会给不相干的人加积分。
 *
 * ## 格式
 *
 * 首行可以是表头（`email,delta` / `邮箱,变动量`）, 也可以是
 * 直接的数据行 —— 两种在 Excel 另存为 CSV 的场景里都很常见, 后端两种都认。
 * 逗号分隔、UTF-8（Excel 中文版另存的 CSV 常带 BOM, 后端会剥掉）。
 */
export function CsvImportDrawer({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [validDays, setValidDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreditImportResult | null>(null);
  const [importPage, setImportPage] = useState(1);
  /**
   * 导入批次的幂等键。选好文件时生成一次，失败重试原样复用；
   * 换文件则重新生成 —— 否则新文件的第 1 行会被当成上次的同名行。
   */
  const [importKey, setImportKey] = useState('');
  const dirty = !result && Boolean(file || validDays.trim());
  useUnsavedGuard(open && dirty);

  const pickFile = (next: File | null) => {
    setFile(next);
    setImportKey(next ? newImportKey() : '');
  };

  /** 关闭时清空: 下次打开不该看到上次选的文件 */
  const close = () => {
    if (busy) return;
    setFile(null);
    setValidDays('');
    setResult(null);
    setImportPage(1);
    setImportKey('');
    onClose();
  };
  const requestClose = useDiscardConfirm(open && dirty, close);
  const done = () => {
    setFile(null);
    setValidDays('');
    setResult(null);
    setImportPage(1);
    setImportKey('');
    onDone();
  };

  /** 失败行排最后 + 客户端分页切片 */
  const paged = useMemo(() => {
    const sorted = [...(result?.results ?? [])].sort(
      (a, b) => Number(a.success) - Number(b.success),
    );
    const totalPages = Math.max(1, Math.ceil(sorted.length / IMPORT_PAGE_SIZE));
    const page = Math.min(importPage, totalPages);
    const start = (page - 1) * IMPORT_PAGE_SIZE;
    return { rows: sorted.slice(start, start + IMPORT_PAGE_SIZE), totalPages, page };
  }, [result, importPage]);

  const submit = async () => {
    if (!file) {
      toast.warning('请先选择 CSV 文件');
      return;
    }
    const days = validDays.trim() ? Number(validDays.trim()) : undefined;
    if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
      toast.warning('有效期必须是不小于 1 的整数天');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.importCsv(file, { validDays: days, importKey });
      setResult(r);
      if (r.failed === 0) toast.success(`已导入 ${r.succeeded} 条`);
      else toast.warning(`成功 ${r.succeeded} 条，失败 ${r.failed} 条`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const resultColumns: Array<AdminColumn<CreditImportResult['results'][number]>> = [
    {
      key: 'row',
      title: '行号',
      width: 70,
      render: (row) => <span className="tabular-nums">{row.row}</span>,
    },
    {
      key: 'email',
      title: '邮箱',
      render: (row) => <span className="text-[12px] text-muted-foreground">{row.email || '—'}</span>,
    },
    {
      key: 'delta',
      title: '变动',
      width: 90,
      render: (row) => (
        <span className="tabular-nums text-xs">
          {Number.isFinite(row.delta) ? signed(row.delta) : '—'}
        </span>
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
      title="导入积分（CSV）"
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
              disabled={busy || !file}
            >
              {busy ? '导入中…' : '开始导入'}
            </ActionButton>
          )}
        </>
      }
    >
      {result ? (
        <DetailSection
          title="导入结果"
          note={`共 ${result.total} 行 · 成功 ${result.succeeded} · 失败 ${result.failed}`}
        >
          {/*
            失败行排在最后 (原 antd 版同样如此): 运营最先要处理的是失败。
            结果是纯前端一次返回的, 所以这里做客户端分页 —— 不走 DataTable 的
            `pagination` prop, 那个会带出 20/50/100 的每页条数选择器, 与
            这里每页 10 行的口径打架。
          */}
          <AdminDataTable
            rows={paged.rows}
            columns={resultColumns}
            rowKey={(row) => String(row.row)}
            density="compact"
            emptyText="没有结果"
          />
          <div className="mt-2 flex justify-end">
            <Pagination
              page={paged.page}
              totalPages={paged.totalPages}
              onChange={setImportPage}
              previousLabel="上一页"
              nextLabel="下一页"
              aria-label="导入结果分页"
            />
          </div>
        </DetailSection>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField
            label="CSV 文件"
            hint="每行 邮箱,变动量，首行可带表头；单次最多 500 行。正数增加、负数扣减。"
          >
            <FilePicker
              file={file}
              accept=".csv,text/csv"
              label="选择 CSV"
              onPick={pickFile}
              onClear={() => pickFile(null)}
            />
          </FormField>

          <FormField label="有效期（天，可选）">
            <TextField
              value={validDays}
              onChange={setValidDays}
              placeholder="留空表示永久有效"
              inputMode="numeric"
              ariaLabel="有效期"
            />
          </FormField>

          <Notice tone="warn">
            导入会立即改变用户可用余额且不可撤销。建议先用几行小数据验证格式，再导全量。
            同一份文件重试不会二次发放（按行幂等），换文件后计数重新开始。
          </Notice>
        </div>
      )}
    </Drawer>
  );
}

/** 导入批次幂等键：选好文件时生成一次，重试原样复用 */
function newImportKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
