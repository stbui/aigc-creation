import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminModelApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Descriptions } from '../../admin-ui/primitives';
import { SelectBox } from '../../admin-ui/controls';
import {
  AdminDrawer,
  AdminStaleError,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { adminTaskHref } from '../../lib/admin-links';
import type { AdminModelCall, AdminModelCallListResult } from '../../types/api';

type Row = AdminModelCall;

/**
 * 模型调用记录（BoardUI，只读）。
 *
 * 与「操作审计」页的分工: 审计记「谁在后台做了什么」,本页记「生成链路每次调模型的明细」。
 * 排障时先看本页的统计卡判断是通道问题还是业务问题, 再下钻到流水看单次明细。
 *
 * 本次改造只换渲染层：筛选的草稿 / 已生效两态、URL 同步、导出同口径、抽屉详情
 * 逐条保留。
 */

/** 路由/通道 → 中文。未登记的原样显示, 便于发现未文档化的取值 */
const ROUTE_LABELS: Record<string, string> = {
  auto: '自动',
  local: '存量本地（已停用）',
  remote: '强制远程',
};

const SOURCE_LABELS: Record<string, string> = {
  gateway: '真实模型',
  local: '历史本地结果',
};

const MODALITY_LABELS: Record<string, string> = {
  image: '图像',
  text: '文本',
  video: '视频',
  unknown: '历史未知',
};

function modalityLabel(value: string | null): string {
  if (!value) return MODALITY_LABELS.unknown;
  return MODALITY_LABELS[value] ?? value;
}

/** 毫秒 → 人类可读。耗时是这个页面的核心指标, 一律带单位 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[11px] text-text-secondary">{children}</code>;
}

/** 抽屉内的分区：标题 + 发丝线，不用卡片套卡片 */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-table pt-3 first:border-t-0 first:pt-0 [&+&]:mt-3">
      <h3 className="mb-2 flex items-baseline gap-2 text-xs font-semibold text-text-primary">
        {title}
        {note && <span className="text-[11px] font-normal text-text-placeholder">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

export function AdminModelCallsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  // 深链/刷新后保留筛选: 排障时经常需要把「这批失败调用」的链接发给同事。
  // 初始值同时喂给 useAdminList, 首次请求即带筛选, 不白跑一次全量查询。
  const [searchParams] = useSearchParams();
  const initialCapability = searchParams.get('capability') ?? undefined;
  const rawModality = searchParams.get('modality');
  const initialModality =
    rawModality === 'image' || rawModality === 'text' || rawModality === 'video' || rawModality === 'unknown'
      ? rawModality
      : undefined;
  const rawSource = searchParams.get('source');
  const initialSource = rawSource === 'gateway' || rawSource === 'local' ? rawSource : undefined;
  const rawSuccess = searchParams.get('success');
  const initialSuccess = rawSuccess === 'true' ? true : rawSuccess === 'false' ? false : undefined;
  const rawFallback = searchParams.get('fallback');
  const initialFallback =
    rawFallback === 'true' ? true : rawFallback === 'false' ? false : undefined;

  const [capability, setCapability] = useState<string | undefined>(initialCapability);
  const [modality, setModality] = useState<string | undefined>(initialModality);
  const [source, setSource] = useState<string | undefined>(initialSource);
  const [success, setSuccess] = useState<string | undefined>(
    initialSuccess === undefined ? undefined : String(initialSuccess),
  );
  const [fallback, setFallback] = useState<string | undefined>(
    initialFallback === undefined ? undefined : String(initialFallback),
  );
  const [detailId, setDetailId] = useAdminDetailParam();
  const [exporting, setExporting] = useState(false);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminModelApi.calls({
        page: params.page as number,
        pageSize: params.pageSize as number,
        capability: params.capability as string | undefined,
        modality: params.modality as string | undefined,
        source: params.source as string | undefined,
        success: params.success === undefined ? undefined : Boolean(params.success),
        fallback: params.fallback === undefined ? undefined : Boolean(params.fallback),
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminModelCallListResult>(fetcher, {
      capability: initialCapability,
      modality: initialModality,
      source: initialSource,
      success: initialSuccess,
      fallback: initialFallback,
    });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    capability: params.capability as string | undefined,
    modality: params.modality as string | undefined,
    source: params.source as string | undefined,
    success: params.success as boolean | undefined,
    fallback: params.fallback as boolean | undefined,
  });

  const list = data?.result;
  const stats = data?.stats;

  const capOptions = useMemo(
    () =>
      (data?.capabilities ?? []).map((c) => ({
        value: c.capability,
        label: `${c.capability}（${c.count}）`,
      })),
    [data],
  );

  const hasFilter = Boolean(capability || modality || source || success || fallback);

  const reset = () => {
    setCapability(undefined);
    setModality(undefined);
    setSource(undefined);
    setSuccess(undefined);
    setFallback(undefined);
    setQuery({
      capability: undefined,
      modality: undefined,
      source: undefined,
      success: undefined,
      fallback: undefined,
    });
  };

  const appliedCapability = params.capability as string | undefined;
  const appliedModality = params.modality as string | undefined;
  const appliedSource = params.source as string | undefined;
  const appliedSuccess = params.success as boolean | undefined;
  const appliedFallback = params.fallback as boolean | undefined;
  const appliedChips: AppliedFilter[] = [
    appliedCapability
      ? {
          key: 'capability',
          label: `能力：${appliedCapability}`,
          onClear: () => {
            setCapability(undefined);
            setQuery({ capability: undefined });
          },
        }
      : null,
    appliedModality
      ? {
          key: 'modality',
          label: `模态：${modalityLabel(appliedModality)}`,
          onClear: () => {
            setModality(undefined);
            setQuery({ modality: undefined });
          },
        }
      : null,
    appliedSource
      ? {
          key: 'source',
          label: `通道：${SOURCE_LABELS[appliedSource] ?? appliedSource}`,
          onClear: () => {
            setSource(undefined);
            setQuery({ source: undefined });
          },
        }
      : null,
    appliedSuccess !== undefined
      ? {
          key: 'success',
          label: `结果：${appliedSuccess ? '成功' : '失败'}`,
          onClear: () => {
            setSuccess(undefined);
            setQuery({ success: undefined });
          },
        }
      : null,
    appliedFallback !== undefined
      ? {
          key: 'fallback',
          label: `历史回落：${appliedFallback ? '已回落' : '未回落'}`,
          onClear: () => {
            setFallback(undefined);
            setQuery({ fallback: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  /** 导出走已生效的筛选条件 —— 必须与屏幕上的列表同口径 */
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminModelApi.exportCsv({
        capability: params.capability as string | undefined,
        modality: params.modality as string | undefined,
        source: params.source as string | undefined,
        success: params.success as boolean | undefined,
        fallback: params.fallback as boolean | undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'createdAt',
        title: '时间',
        width: 160,
        render: (row) => new Date(row.createdAt).toLocaleString('zh-CN'),
      },
      {
        key: 'capability',
        title: '能力',
        width: 130,
        render: (row) => (
          <div className="min-w-0">
            <Mono>{row.capability}</Mono>
            <div className="mt-0.5 text-[11px] text-text-tertiary">{modalityLabel(row.modality)}</div>
          </div>
        ),
      },
      {
        key: 'route',
        title: '路由',
        width: 110,
        render: (row) => ROUTE_LABELS[row.route] ?? row.route,
      },
      {
        key: 'source',
        title: '实际通道',
        width: 140,
        render: (row) => (
          <div className="flex flex-wrap items-center gap-1">
            <StatusTag
              status="source"
              tone={row.source === 'gateway' ? 'success' : 'muted'}
              label={SOURCE_LABELS[row.source] ?? row.source}
            />
            {row.fallback && <StatusTag status="fallback" tone="danger" label="历史回落" />}
          </div>
        ),
      },
      {
        key: 'model',
        title: '模型',
        width: 140,
        render: (row) =>
          row.model ? <Mono>{row.model}</Mono> : <span className="text-text-placeholder">—</span>,
      },
      {
        key: 'durationMs',
        title: '耗时',
        width: 90,
        align: 'right',
        render: (row) => <span className="tabular-nums">{fmtDuration(row.durationMs)}</span>,
      },
      {
        key: 'output',
        title: '产出',
        width: 130,
        render: (row) => (
          <div>
            <div className="tabular-nums">
              {row.width && row.height ? `${row.width}×${row.height}` : '—'}
            </div>
            <div className="text-[11px] text-text-tertiary">{fmtBytes(row.outputBytes)}</div>
          </div>
        ),
      },
      {
        key: 'success',
        title: '结果',
        width: 70,
        render: (row) => (
          <StatusTag
            status={row.success ? 'succeeded' : 'failed'}
            label={row.success ? '成功' : '失败'}
          />
        ),
      },
      {
        key: 'detail',
        title: '',
        width: 60,
        render: (row) => (
          <Button variant="ghost" size="small" onClick={() => setDetailId(row.id)}>
            详情
          </Button>
        ),
      },
    ],
    [setDetailId],
  );

  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('记录不存在');
    return adminModelApi.callDetail(detailId);
  }, [detailId]);

  const successRate =
    stats && stats.total > 0 ? `${Math.round((stats.successCount / stats.total) * 100)}%` : '—';

  return (
    <>
      <PageHeader
        title="模型调用记录"
        description="生成链路每次调用模型的明细：耗时、产出与失败原因。只读，不可删除或修改。"
        actions={
          can('data.export') ? (
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          ) : undefined
        }
      />

      {/* 统计卡: 单看流水要看上百行, 而运营真正想问的是这几个数 */}
      {/* auto-fit 而不是固定列数：1440px 下 2xl 断点没触发时 5 张卡会排成 3+2，
          第二行空出三格。与其它带统计卡的后台页保持一致。 */}
      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        <StatCard label="调用总数" value={stats?.total ?? '—'} hint="当前筛选条件下" />
        <StatCard
          label="成功率"
          value={successRate}
          hint={`成功 ${stats?.successCount ?? 0} 次`}
          tone={stats && stats.successCount < stats.total ? 'warn' : undefined}
        />
        <StatCard
          label="真实模型占比"
          value={
            stats?.total ? `${Math.round(((stats?.gatewayCount ?? 0) / stats.total) * 100)}%` : '—'
          }
          hint={`远程 ${stats?.gatewayCount ?? 0} · 历史本地 ${stats?.localCount ?? 0}`}
          tone={stats?.gatewayCount === 0 ? 'warn' : undefined}
        />
        <StatCard
          label="历史回落次数"
          value={stats?.fallbackCount ?? 0}
          hint="本地生成停用前由网关失败触发的回落记录"
          tone={(stats?.fallbackCount ?? 0) > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="平均耗时"
          value={stats ? fmtDuration(stats.avgDurationMs) : '—'}
          hint={
            stats?.gatewayAvgDurationMs
              ? `真实模型 ${fmtDuration(stats.gatewayAvgDurationMs)}`
              : '真实模型暂无样本'
          }
        />
      </div>

      <FilterBar>
        <SelectBox
          className="w-44"
          ariaLabel="按能力筛选"
          placeholder="能力"
          options={capOptions}
          value={capability}
          onChange={setCapability}
          allowClear
        />
        <SelectBox
          className="w-32"
          ariaLabel="按模态筛选"
          placeholder="模态"
          options={[
            { value: 'image', label: '图像' },
            { value: 'text', label: '文本' },
            { value: 'video', label: '视频' },
            { value: 'unknown', label: '历史未知' },
          ]}
          value={modality}
          onChange={setModality}
          allowClear
        />
        <SelectBox
          className="w-40"
          ariaLabel="按通道筛选"
          placeholder="通道"
          options={[
            { value: 'gateway', label: '真实模型' },
            { value: 'local', label: '历史本地结果' },
          ]}
          value={source}
          onChange={setSource}
          allowClear
        />
        <SelectBox
          className="w-28"
          ariaLabel="按结果筛选"
          placeholder="结果"
          options={[
            { value: 'true', label: '成功' },
            { value: 'false', label: '失败' },
          ]}
          value={success}
          onChange={setSuccess}
          allowClear
        />
        <SelectBox
          className="w-32"
          ariaLabel="按历史回落筛选"
          placeholder="历史回落"
          options={[
            { value: 'true', label: '已回落' },
            { value: 'false', label: '未回落' },
          ]}
          value={fallback}
          onChange={setFallback}
          allowClear
        />
        <FilterActions>
          <Button
            variant="primary"
            size="small"
            onClick={() =>
              setQuery({
                capability,
                source,
                success: success === undefined ? undefined : success === 'true',
                fallback: fallback === undefined ? undefined : fallback === 'true',
              })
            }
          >
            查询
          </Button>
          <Button variant="secondary" size="small" onClick={reset}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel>
        <AdminDataTable<Row>
          rows={list?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1080}
          emptyText={
            hasFilter
              ? '没有符合条件的调用记录。清除筛选后再试。'
              : '暂无调用记录。在前台任意生成一次（如下「自由创作」页），这里就会出现明细。'
          }
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="small" onClick={reset}>
                清除筛选
              </Button>
            ) : undefined
          }
          pagination={{
            current: list?.page ?? 1,
            pageSize: list?.pageSize ?? 20,
            total: list?.total ?? 0,
            onChange: setPage,
          }}
        />
      </Panel>

      <AdminDrawer<Row>
        open={detailId !== null}
        title="调用详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
      >
        {(row) => (
          <>
            <Section title="调用概要">
              <Descriptions
                columns={2}
                items={[
                  { label: '时间', value: new Date(row.createdAt).toLocaleString('zh-CN') },
                  { label: '能力', value: <Mono>{row.capability}</Mono> },
                  { label: '模态', value: modalityLabel(row.modality) },
                  { label: '路由决策', value: ROUTE_LABELS[row.route] ?? row.route },
                  {
                    label: '实际通道',
                    value: (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        {SOURCE_LABELS[row.source] ?? row.source}
                        {row.fallback && (
                          <StatusTag status="fallback" tone="danger" label="历史回落" />
                        )}
                      </span>
                    ),
                  },
                  { label: '模型', value: row.model ? <Mono>{row.model}</Mono> : '—' },
                  { label: '耗时', value: <span className="tabular-nums">{fmtDuration(row.durationMs)}</span> },
                  {
                    label: '产出',
                    value: (
                      <>
                        {row.width && row.height ? `${row.width}×${row.height}` : '—'} ·{' '}
                        {fmtBytes(row.outputBytes)}
                      </>
                    ),
                  },
                  {
                    label: '结果',
                    value: (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <StatusTag
                          status={row.success ? 'succeeded' : 'failed'}
                          label={row.success ? '成功' : '失败'}
                        />
                        {row.errorCode && <Mono>{row.errorCode}</Mono>}
                      </span>
                    ),
                  },
                  ...(row.generationTaskId
                    ? [
                        {
                          label: '生成任务',
                          value: (
                            <Link
                              className="text-accent-600 hover:underline"
                              to={adminTaskHref(row.generationTaskId)}
                            >
                              <Mono>{row.generationTaskId}</Mono>
                            </Link>
                          ),
                        },
                      ]
                    : row.gatewayTaskId
                      ? [
                          {
                            // 渠道任务号在本地任务表里不存在，只用于和通道对账，
                            // 不能渲染成任务页链接（会稳定 404）。
                            label: '渠道任务 ID',
                            value: <Mono>{row.gatewayTaskId}</Mono>,
                          },
                        ]
                    : []),
                ]}
              />
            </Section>

            {row.reason && (
              <Section title={row.fallback ? '历史回落原因' : '备注'}>
                <div className="rounded-lg border border-border-table bg-amber-50/60 px-2.5 py-2 text-xs text-text-primary">
                  {row.reason}
                </div>
              </Section>
            )}

            {row.prompt && (
              <Section
                title="送出提示词"
                note={
                  row.generationTaskId
                    ? '超长内容已截断，完整参数见生成任务记录'
                    : '超长内容已截断'
                }
              >
                <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-table bg-background-secondary-default px-2.5 py-2 font-mono text-[11px] leading-5 text-text-secondary">
                  {row.prompt}
                </pre>
              </Section>
            )}
          </>
        )}
      </AdminDrawer>
    </>
  );
}
