import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Select, Table, Upload as AntUpload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd';
import { Download, Upload } from 'lucide-react';
import { Drawer } from 'antd';
import { adminReconciliationApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  adminMiniPagination,
  adminPagination,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
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

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function AdminReconciliationPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  /** payment.read 可看批次；导入与差异处置需要 finance.reconcile */
  const canReconcile = can('finance.reconcile');

  const [channel, setChannel] = useState('alipay');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [importing, setImporting] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationBatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [resolving, setResolving] = useState<{
    item: ReconciliationItem;
    status: 'resolved' | 'ignored';
  } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminReconciliationApi.batches(
        params.pageSize as number,
        ((params.page as number) - 1) * (params.pageSize as number),
      ),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<{ items: ReconciliationBatch[]; total: number }>(fetcher);

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
    void loadDetail(detailId);
  }, [detailId, loadDetail]);

  const runImport = async () => {
    if (!file) {
      void message.warning('请选择渠道账单文件 (CSV)');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
      void message.warning('请选择账单日期');
      return;
    }
    setImporting(true);
    try {
      const r = await adminReconciliationApi.importFile(file, channel, billDate);
      void message.success(
        r.batch.diffCount > 0
          ? `导入完成：${r.batch.matchedCount} 笔一致，${r.batch.diffCount} 笔差异待处理`
          : `导入完成：${r.batch.matchedCount} 笔全部一致`,
      );
      setFile(null);
      setFileList([]);
      reload();
      setDetailId(r.batch.id);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const runResolve = async () => {
    if (!resolving) return;
    const trimmed = note.trim();
    if (!trimmed) {
      void message.warning('请填写处置说明，它对账时是唯一的解释');
      return;
    }
    setBusy(true);
    try {
      await adminReconciliationApi.resolve(resolving.item.id, resolving.status, trimmed);
      void message.success(resolving.status === 'resolved' ? '已标记为处理完成' : '已标记为忽略');
      setResolving(null);
      setNote('');
      if (detailId) void loadDetail(detailId);
      reload();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '处置失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<ReconciliationBatch> = [
    {
      title: '渠道 / 账单日',
      key: 'channel',
      width: 160,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{CHANNEL_LABELS[row.channel] ?? row.channel}</span>
          <span className="adm-cell-sub">{row.billDate}</span>
        </div>
      ),
    },
    {
      title: '账单文件',
      key: 'file',
      width: 190,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span className="adm-cell-sub">{row.fileName ?? '—'}</span>
          <span className="adm-cell-sub">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>
        </div>
      ),
    },
    {
      title: '渠道侧',
      key: 'channelSide',
      width: 140,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.channelCount} 笔</span>
          <span className="adm-cell-sub">¥ {yuan(row.channelAmountCents)}</span>
        </div>
      ),
    },
    {
      title: '本地侧',
      key: 'localSide',
      width: 140,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.localCount} 笔</span>
          <span className="adm-cell-sub">¥ {yuan(row.localAmountCents)}</span>
        </div>
      ),
    },
    {
      title: '一致 / 差异',
      key: 'diff',
      width: 130,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.matchedCount} 笔一致</span>
          {row.diffCount > 0 ? (
            <span className="adm-cell-sub adm-text-danger">
              {row.diffCount} 笔差异
            </span>
          ) : (
            <span className="adm-cell-sub">无差异</span>
          )}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => (
        <StatusTag
          status={v === 'resolved' ? 'success' : 'warning'}
          label={v === 'resolved' ? '已结案' : '待处置'}
        />
      ),
    },
    {
      title: '',
      key: 'ops',
      width: 150,
      render: (_: unknown, row) => (
        <div className="adm-ops">
          <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
            详情
          </Button>
          {can('data.export') && (
            <Button
              type="link"
              className="adm-link"
              onClick={() =>
                void adminReconciliationApi
                  .exportCsv(row.id)
                  .catch((e: Error) => message.error(e.message))
              }
            >
              导出
            </Button>
          )}
        </div>
      ),
    },
  ];

  const itemColumns: ColumnsType<ReconciliationItem> = [
    {
      title: '渠道交易号',
      dataIndex: 'tradeNo',
      key: 'tradeNo',
      width: 190,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: '差异',
      dataIndex: 'diffType',
      key: 'diffType',
      width: 110,
      render: (v: ReconciliationDiffType) => <StatusTag status={DIFF_TONES[v]} label={DIFF_LABELS[v]} />,
    },
    {
      title: '渠道 / 本地金额',
      key: 'amount',
      width: 150,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>¥ {yuan(row.channelAmountCents)}</span>
          <span className="adm-cell-sub">本地 ¥ {yuan(row.localAmountCents)}</span>
        </div>
      ),
    },
    {
      title: '处置',
      key: 'status',
      width: 150,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>
            {row.status === 'open' ? '待处理' : row.status === 'resolved' ? '已处理' : '已忽略'}
          </span>
          {row.note && <span className="adm-cell-sub">{row.note}</span>}
        </div>
      ),
    },
    {
      title: '',
      key: 'ops',
      width: 130,
      render: (_: unknown, row) =>
        row.status === 'open' && can('finance.reconcile') ? (
          <div className="adm-ops">
            <Button
              type="link"
              className="adm-link"
              onClick={() => {
                setResolving({ item: row, status: 'resolved' });
                setNote('');
              }}
            >
              标记处理
            </Button>
            <Button
              type="link"
              className="adm-link"
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
        <FilterBar>
          <Select
            className="adm-filter-select"
            value={channel}
            onChange={setChannel}
            options={CHANNEL_OPTIONS}
            disabled={!canReconcile}
          />
          <Input
            className="adm-filter-input"
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            disabled={!canReconcile}
          />
          <AntUpload
            accept=".csv,text/csv"
            maxCount={1}
            fileList={fileList}
            disabled={!canReconcile}
            beforeUpload={(next) => {
              setFile(next as File);
              setFileList([next]);
              return false;
            }}
            onRemove={() => {
              setFile(null);
              setFileList([]);
            }}
          >
            <Button icon={<Upload size={14} />} disabled={!canReconcile}>
              选择 CSV
            </Button>
          </AntUpload>
          <FilterActions>
            <Button
              type="primary"
              className="adm-btn is-primary"
              disabled={importing || !canReconcile}
              onClick={() => void runImport()}
            >
              <Upload size={14} style={{ marginRight: 4 }} />
              {importing ? '导入中…' : '导入并比对'}
            </Button>
          </FilterActions>
        </FilterBar>
      </Panel>

      {/* 刷新失败但手上还有上一次的批次列表: 明说是旧数据, 别让人拿它下处置结论 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel title="对账批次" note="批次在全部差异处置完成后自动结案">
        {loading && !data ? (
          <AdminListLoading tip="加载对账批次…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (data?.items.length ?? 0) === 0 ? (
          <AdminEmpty description="还没有对账记录。导入一份渠道账单开始核对。" />
        ) : (
          <Table<ReconciliationBatch>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            scroll={{ x: 1000 }}
            pagination={adminPagination({
              current: (params.page as number) || 1,
              pageSize: (params.pageSize as number) || 20,
              total: data?.total ?? 0,
              onChange: setPage,
            })}
          />
        )}
      </Panel>

      <Drawer
        title="对账明细"
        size={880}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        className="adm-drawer"
        destroyOnHidden
      >
        {detailLoading ? (
          <AdminListLoading tip="加载明细…" />
        ) : detailError ? (
          <AdminListError
            error={detailError}
            onRetry={() => detailId && void loadDetail(detailId)}
          />
        ) : detail ? (
          <>
            <dl className="adm-desc">
              <dt>渠道</dt>
              <dd>{CHANNEL_LABELS[detail.batch.channel] ?? detail.batch.channel}</dd>
              <dt>账单日</dt>
              <dd>{detail.batch.billDate}</dd>
              <dt>渠道合计</dt>
              <dd>
                {detail.batch.channelCount} 笔 · ¥ {yuan(detail.batch.channelAmountCents)}
              </dd>
              <dt>本地合计</dt>
              <dd>
                {detail.batch.localCount} 笔 · ¥ {yuan(detail.batch.localAmountCents)}
              </dd>
              <dt>差额</dt>
              <dd>
                ¥ {yuan(detail.batch.channelAmountCents - detail.batch.localAmountCents)}
                {detail.batch.diffCount > 0 && (
                  <span className="adm-cell-sub"> · {detail.batch.diffCount} 笔差异待处置</span>
                )}
              </dd>
            </dl>

            <div className="adm-section">
              <div className="adm-section-title">
                差异明细
                <span className="adm-panel-note">一致的行默认已标记处理</span>
              </div>
              <Table<ReconciliationItem>
                rowKey="id"
                size="small"
                columns={itemColumns}
                dataSource={detail.items}
                pagination={adminMiniPagination()}
                scroll={{ x: 730 }}
              />
            </div>

            {can('data.export') && (
              <Button
                type="default"
                className="adm-btn"
                onClick={() =>
                  void adminReconciliationApi
                    .exportCsv(detail.batch.id)
                    .catch((e: Error) => message.error(e.message))
                }
              >
                <Download size={14} style={{ marginRight: 4 }} />
                导出差异清单
              </Button>
            )}
          </>
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
              <p className="adm-cell-sub">
                交易号 <code>{resolving.item.tradeNo}</code> ·{' '}
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
            <div className="adm-confirm-typing">
              <label htmlFor="adm-recon-note">处置说明（强制，写入审计）：</label>
              <Input
                id="adm-recon-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  resolving.status === 'resolved'
                    ? '如：已在订单模块补单，订单号 xxx'
                    : '如：渠道侧重复推送，本地仅一笔'
                }
                maxLength={300}
                autoComplete="off"
              />
            </div>
          }
        />
      )}
    </>
  );
}
