import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import { Button } from '../../admin-ui/shadcn/kit';
import { adminReconciliationApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { Descriptions } from '../../admin-ui/primitives';
import { FilePick, SelectBox, TextInput } from '../../admin-ui/controls';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import type {
  ReconciliationBatch,
  ReconciliationBatchDetail,
  ReconciliationDiffType,
  ReconciliationItem,
} from '../../types/api';

/**
 * 渠道对账。
 *
 * 工作流是「导账单 → 看差异 → 逐笔处置」, 所以页面主体是**批次列表**,
 * 差异明细放在抽屉里 —— 差异笔数可能上百条, 铺在主表里会让批次之间无法比较。
 *
 * 三条不能含糊的规则:
 *
 * 1. **处置不改钱**。差异行只能被标记 (已处理 / 已忽略) 并填写说明,
 *    真正的补单/退款去订单模块做。对账工具改钱是最容易造出双向不一致的设计。
 * 2. **金额单位由表头决定**。渠道账单有的给「分」有的给「元」, 解析规则
 *    在后端 (common/csv + reconciliation.service), 前端只展示结果。
 * 3. **全部处置完批次才算结案**。只要还有 open 行, 批次状态就是 imported。
 */

const CHANNEL_OPTIONS = [
  { value: 'sandbox', label: '沙箱' },
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信支付' },
];

const CHANNEL_LABELS: Record<string, string> = {
  sandbox: '沙箱',
  alipay: '支付宝',
  wechat: '微信支付',
};

const DIFF_LABELS: Record<ReconciliationDiffType, string> = {
  matched: '一致',
  amount_mismatch: '金额不符',
  missing_local: '本地缺单',
  missing_channel: '渠道缺单',
  duplicate: '重复交易',
};

/** 差异类型 → StatusTag 的状态词 (沿用后台既有的色彩语义) */
const DIFF_TONES: Record<ReconciliationDiffType, string> = {
  matched: 'success',
  amount_mismatch: 'failed',
  missing_local: 'failed',
  missing_channel: 'failed',
  duplicate: 'warning',
};

/** 抽屉内差异明细的每页条数。与数据表的分页尺寸选项对齐 */
const ITEM_PAGE_SIZE = 20;

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function AdminReconciliationPage() {
  const toast = useToast();
  const { can } = useAdmin();
  /** payment.read 可看批次；导入与差异处置需要 finance.reconcile */
  const canReconcile = can('finance.reconcile');

  const [channel, setChannel] = useState('alipay');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationBatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [itemPage, setItemPage] = useState(1);

  const [resolving, setResolving] = useState<{
    item: ReconciliationItem;
    status: 'resolved' | 'ignored';
  } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // 批次列表筛选与“导入账单”表单分开：前者是查询条件，后者是待提交内容。
  const [searchParams] = useSearchParams();
  const rawFilterChannel = searchParams.get('channel');
  const initialFilterChannel =
    rawFilterChannel && CHANNEL_OPTIONS.some((o) => o.value === rawFilterChannel)
      ? rawFilterChannel
      : undefined;
  const rawFilterStatus = searchParams.get('status');
  const initialFilterStatus: 'imported' | 'resolved' | undefined =
    rawFilterStatus === 'imported' || rawFilterStatus === 'resolved'
      ? rawFilterStatus
      : undefined;
  const dateParam = (key: string) => {
    const value = searchParams.get(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  };
  const initialFilterFrom = dateParam('from');
  const initialFilterTo = dateParam('to');
  const [filterChannel, setFilterChannel] = useState<string | undefined>(initialFilterChannel);
  const [filterStatus, setFilterStatus] = useState<'imported' | 'resolved' | undefined>(
    initialFilterStatus,
  );
  const [filterFrom, setFilterFrom] = useState(initialFilterFrom);
  const [filterTo, setFilterTo] = useState(initialFilterTo);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminReconciliationApi.batches({
        limit: params.pageSize as number,
        offset: ((params.page as number) - 1) * (params.pageSize as number),
        channel: params.channel as string | undefined,
        status: params.status as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<{ items: ReconciliationBatch[]; total: number }>(fetcher, {
      ...(initialFilterChannel ? { channel: initialFilterChannel } : {}),
      ...(initialFilterStatus ? { status: initialFilterStatus } : {}),
      ...(initialFilterFrom ? { from: initialFilterFrom } : {}),
      ...(initialFilterTo ? { to: initialFilterTo } : {}),
    });

  useAdminUrlFilterSync({
    channel: params.channel as string | undefined,
    status: params.status as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });

  const appliedChannel = params.channel as string | undefined;
  const appliedStatus = params.status as 'imported' | 'resolved' | undefined;
  const appliedFrom = (params.from as string | undefined) ?? '';
  const appliedTo = (params.to as string | undefined) ?? '';
  const appliedFilters: AppliedFilter[] = [
    appliedChannel
      ? {
          key: 'channel',
          label: `渠道：${CHANNEL_LABELS[appliedChannel] ?? appliedChannel}`,
          onClear: () => {
            setFilterChannel(undefined);
            setQuery({ channel: undefined });
          },
        }
      : null,
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${appliedStatus === 'resolved' ? '已结案' : '待处置'}`,
          onClear: () => {
            setFilterStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedFrom
      ? {
          key: 'from',
          label: `账单日 ≥ ${appliedFrom}`,
          onClear: () => {
            setFilterFrom('');
            setQuery({ from: undefined });
          },
        }
      : null,
    appliedTo
      ? {
          key: 'to',
          label: `账单日 ≤ ${appliedTo}`,
          onClear: () => {
            setFilterTo('');
            setQuery({ to: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];
  const hasBatchFilter = appliedFilters.length > 0;
  const resetBatchFilters = () => {
    setFilterChannel(undefined);
    setFilterStatus(undefined);
    setFilterFrom('');
    setFilterTo('');
    setQuery({ channel: undefined, status: undefined, from: undefined, to: undefined });
  };

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await adminReconciliationApi.batch(id));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '对账批次加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    // 换批次要回到第一页：上一批的页码与这一批的条数无关
    setItemPage(1);
    void loadDetail(detailId);
  }, [detailId, loadDetail]);

  const runImport = async () => {
    if (!file) {
      toast.warning('请选择渠道账单文件 (CSV)');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
      toast.warning('请选择账单日期');
      return;
    }
    setImporting(true);
    try {
      const r = await adminReconciliationApi.importFile(file, channel, billDate);
      toast.success(
        r.batch.diffCount > 0
          ? `导入完成：${r.batch.matchedCount} 笔一致，${r.batch.diffCount} 笔差异待处理`
          : `导入完成：${r.batch.matchedCount} 笔全部一致`,
      );
      setFile(null);
      reload();
      setDetailId(r.batch.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const runResolve = async () => {
    if (!resolving) return;
    const trimmed = note.trim();
    if (!trimmed) {
      toast.warning('请填写处置说明，它对账时是唯一的解释');
      return;
    }
    setBusy(true);
    try {
      await adminReconciliationApi.resolve(resolving.item.id, resolving.status, trimmed);
      toast.success(resolving.status === 'resolved' ? '已标记为处理完成' : '已标记为忽略');
      setResolving(null);
      setNote('');
      if (detailId) void loadDetail(detailId);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处置失败');
    } finally {
      setBusy(false);
    }
  };

  const exportBatch = (id: string) => {
    void adminReconciliationApi.exportCsv(id).catch((e: Error) => toast.error(e.message));
  };

  const columns: Array<AdminColumn<ReconciliationBatch>> = [
    {
      key: 'channel',
      title: '渠道 / 账单日',
      width: 160,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{CHANNEL_LABELS[row.channel] ?? row.channel}</span>
          <span className="text-[11px] tabular-nums text-text-tertiary">{row.billDate}</span>
        </div>
      ),
    },
    {
      key: 'file',
      title: '账单文件',
      width: 200,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="max-w-[190px] truncate text-[11px] text-text-secondary" title={row.fileName ?? undefined}>
            {row.fileName ?? '—'}
          </span>
          <span className="text-[11px] text-text-tertiary">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
      ),
    },
    {
      key: 'channelSide',
      title: '渠道侧',
      width: 140,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{row.channelCount} 笔</span>
          <span className="text-[11px] tabular-nums text-text-tertiary">
            ¥ {yuan(row.channelAmountCents)}
          </span>
        </div>
      ),
    },
    {
      key: 'localSide',
      title: '本地侧',
      width: 140,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{row.localCount} 笔</span>
          <span className="text-[11px] tabular-nums text-text-tertiary">
            ¥ {yuan(row.localAmountCents)}
          </span>
        </div>
      ),
    },
    {
      key: 'diff',
      title: '一致 / 差异',
      width: 130,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{row.matchedCount} 笔一致</span>
          {row.diffCount > 0 ? (
            <span className="text-[11px] tabular-nums text-rose-600">{row.diffCount} 笔差异</span>
          ) : (
            <span className="text-[11px] text-text-tertiary">无差异</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => (
        <StatusTag
          status={row.status === 'resolved' ? 'success' : 'warning'}
          label={row.status === 'resolved' ? '已结案' : '待处置'}
        />
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 150,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="small" onClick={() => setDetailId(row.id)}>
            详情
          </Button>
          {can('data.export') && (
            <Button variant="ghost" size="small" onClick={() => exportBatch(row.id)}>
              导出
            </Button>
          )}
        </div>
      ),
    },
  ];

  const itemColumns: Array<AdminColumn<ReconciliationItem>> = [
    {
      key: 'tradeNo',
      title: '渠道交易号',
      width: 190,
      render: (row) => <code className="font-mono text-xs text-text-secondary">{row.tradeNo}</code>,
    },
    {
      key: 'diffType',
      title: '差异',
      width: 110,
      render: (row) => (
        <StatusTag status={DIFF_TONES[row.diffType]} label={DIFF_LABELS[row.diffType]} />
      ),
    },
    {
      key: 'amount',
      title: '渠道 / 本地金额',
      width: 150,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">¥ {yuan(row.channelAmountCents)}</span>
          <span className="text-[11px] tabular-nums text-text-tertiary">
            本地 ¥ {yuan(row.localAmountCents)}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      title: '处置',
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>
            {row.status === 'open' ? '待处理' : row.status === 'resolved' ? '已处理' : '已忽略'}
          </span>
          {row.note && (
            <span className="max-w-[170px] truncate text-[11px] text-text-tertiary" title={row.note}>
              {row.note}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 140,
      render: (row) =>
        row.status === 'open' && canReconcile ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setResolving({ item: row, status: 'resolved' });
                setNote('');
              }}
            >
              标记处理
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setResolving({ item: row, status: 'ignored' });
                setNote('');
              }}
            >
              忽略
            </Button>
          </div>
        ) : null,
    },
  ];

  const itemRows = detail ? detail.items : [];
  const pagedItems = itemRows.slice(
    (itemPage - 1) * ITEM_PAGE_SIZE,
    itemPage * ITEM_PAGE_SIZE,
  );

  return (
    <>
      <PageHeader
        title="渠道对账"
        description="导入渠道账单，逐笔比对本地支付流水。差异只能标记与说明，补单退款请回订单模块操作。"
      />

      <Panel
        title="导入账单"
        note={
          canReconcile
            ? 'CSV，表头需含交易号与金额（支持 tradeno / transaction_id / 交易号 等别名）'
            : '当前账号无 finance.reconcile 权限，只能查看批次与差异，不能导入或处置'
        }
      >
        {/* 面板内不再套一层筛选框：FormRow 直接铺开，避免「框套框」 */}
        <div className="flex flex-wrap items-center gap-2">
          <SelectBox
            className="w-32"
            ariaLabel="渠道"
            value={channel}
            onChange={(value) => setChannel(value ?? 'alipay')}
            options={CHANNEL_OPTIONS}
            disabled={!canReconcile}
          />
          <TextInput
            className="w-40"
            ariaLabel="账单日期"
            type="date"
            value={billDate}
            onChange={setBillDate}
            disabled={!canReconcile}
          />
          <FilePick
            file={file}
            accept=".csv,text/csv"
            label="选择 CSV"
            hint="尚未选择文件"
            disabled={!canReconcile}
            onPick={setFile}
            onClear={() => setFile(null)}
          />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="primary"
              size="small"
              leadingIcon={Upload}
              disabled={importing || !canReconcile}
              onClick={() => void runImport()}
            >
              {importing ? '导入中…' : '导入并比对'}
            </Button>
          </div>
        </div>
      </Panel>

      {/* 刷新失败但手上还有上一次的批次列表: 明说是旧数据, 别让人拿它下处置结论 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <FilterBar>
        <SelectBox
          className="w-32"
          ariaLabel="按渠道筛选"
          placeholder="全部渠道"
          allowClear
          value={filterChannel}
          onChange={(value) => {
            setFilterChannel(value);
            setQuery({ channel: value });
          }}
          options={CHANNEL_OPTIONS}
        />
        <SelectBox
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="全部状态"
          allowClear
          value={filterStatus}
          onChange={(value) => {
            setFilterStatus(value as 'imported' | 'resolved' | undefined);
            setQuery({ status: value });
          }}
          options={[
            { value: 'imported', label: '待处置' },
            { value: 'resolved', label: '已结案' },
          ]}
        />
        <TextInput
          className="w-40"
          ariaLabel="账单日开始日期"
          type="date"
          value={filterFrom}
          onChange={(value) => {
            setFilterFrom(value);
            setQuery({ from: value || undefined });
          }}
        />
        <TextInput
          className="w-40"
          ariaLabel="账单日结束日期"
          type="date"
          value={filterTo}
          onChange={(value) => {
            setFilterTo(value);
            setQuery({ to: value || undefined });
          }}
        />
        <FilterActions>
          <Button variant="secondary" size="small" onClick={resetBatchFilters}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedFilters} onClearAll={resetBatchFilters} />
      </FilterBar>

      <Panel title="对账批次" note="批次在全部差异处置完成后自动结案">
        <AdminDataTable<ReconciliationBatch>
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1010}
          pagination={{
            current: (params.page as number) || 1,
            pageSize: (params.pageSize as number) || 20,
            total: data?.total ?? 0,
            unit: '个批次',
            onChange: setPage,
          }}
          emptyText={
            hasBatchFilter
              ? '当前筛选下没有对账批次。'
              : '还没有对账记录。导入一份渠道账单开始核对。'
          }
          emptyAction={
            hasBatchFilter ? (
              <Button variant="secondary" size="small" onClick={resetBatchFilters}>
                清除筛选
              </Button>
            ) : undefined
          }
        />
      </Panel>

      <Drawer
        open={detailId !== null}
        onOpenChange={(next) => {
          if (!next) setDetailId(null);
        }}
        width={880}
        title="对账明细"
        description={detail ? `${CHANNEL_LABELS[detail.batch.channel] ?? detail.batch.channel} · ${detail.batch.billDate}` : undefined}
        footer={
          detail && can('data.export') ? (
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              onClick={() => exportBatch(detail.batch.id)}
            >
              导出差异清单
            </Button>
          ) : undefined
        }
      >
        {detailLoading ? (
          <AdminListLoading tip="加载明细…" />
        ) : detailError ? (
          <AdminListError
            error={detailError}
            onRetry={() => {
              if (detailId) void loadDetail(detailId);
            }}
          />
        ) : detail ? (
          <div className="flex flex-col gap-5">
            <Descriptions
              columns={2}
              items={[
                {
                  label: '渠道合计',
                  value: (
                    <span className="tabular-nums">
                      {detail.batch.channelCount} 笔 · ¥ {yuan(detail.batch.channelAmountCents)}
                    </span>
                  ),
                },
                {
                  label: '本地合计',
                  value: (
                    <span className="tabular-nums">
                      {detail.batch.localCount} 笔 · ¥ {yuan(detail.batch.localAmountCents)}
                    </span>
                  ),
                },
                {
                  label: '差额',
                  value: (
                    <span className="tabular-nums">
                      ¥ {yuan(detail.batch.channelAmountCents - detail.batch.localAmountCents)}
                      {detail.batch.diffCount > 0 && (
                        <span className="text-[11px] text-text-tertiary">
                          {' '}
                          · {detail.batch.diffCount} 笔差异待处置
                        </span>
                      )}
                    </span>
                  ),
                },
              ]}
            />

            <section>
              <div className="mb-2 flex items-baseline gap-2 border-b border-border-table pb-1.5">
                <strong className="text-xs font-semibold text-text-primary">差异明细</strong>
                <span className="text-[11px] text-text-tertiary">一致的行默认已标记处理</span>
              </div>
              <AdminDataTable<ReconciliationItem>
                rows={pagedItems}
                columns={itemColumns}
                rowKey={(row) => row.id}
                minWidth={770}
                pagination={{
                  current: itemPage,
                  pageSize: ITEM_PAGE_SIZE,
                  total: itemRows.length,
                  onChange: (next) => setItemPage(next),
                }}
                emptyText="这一批没有差异行"
              />
            </section>
          </div>
        ) : (
          <AdminEmpty description="没有可展示的对账明细。" />
        )}
      </Drawer>

      {resolving && (
        <ConfirmAction
          open
          title={resolving.status === 'resolved' ? '标记为已处理' : '忽略该差异'}
          confirmText="确认"
          danger={resolving.status === 'ignored'}
          loading={busy}
          onCancel={() => setResolving(null)}
          onConfirm={() => void runResolve()}
          description={
            <>
              <p>
                该操作只改变差异行的状态，<b>不会修改任何金额或订单</b>。若需要补单或退款，请到订单管理执行。
              </p>
              <p className="text-[11px] text-text-tertiary">
                交易号 <code className="font-mono">{resolving.item.tradeNo}</code> ·{' '}
                {DIFF_LABELS[resolving.item.diffType]} · 渠道 ¥{' '}
                {yuan(resolving.item.channelAmountCents)} / 本地 ¥{' '}
                {yuan(resolving.item.localAmountCents)}
              </p>
            </>
          }
          impact={[
            `差异行 → ${resolving.status === 'resolved' ? '已处理' : '已忽略'}`,
            '批次在全部差异处置完成后自动结案',
            '写操作审计（含操作人）',
          ]}
          extra={
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-text-secondary">处置说明（强制，写入审计）：</span>
              <TextInput
                ariaLabel="处置说明"
                value={note}
                onChange={setNote}
                placeholder={
                  resolving.status === 'resolved'
                    ? '如：已在订单模块补单，订单号 xxx'
                    : '如：渠道侧重复推送，本地仅一笔'
                }
                maxLength={300}
              />
            </div>
          }
        />
      )}
    </>
  );
}
