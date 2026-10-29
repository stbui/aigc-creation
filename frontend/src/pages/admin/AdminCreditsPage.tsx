import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Button, Drawer, Input, Select, Table, Upload as AntUpload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd';
import { Download, Upload } from 'lucide-react';
import { adminCreditsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  adminMiniPagination,
  adminPagination,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
} from '../../components/admin/PageHeader';
import type {
  AdminCreditLedgerRow,
  AdminCreditListResult,
  AdminCreditLotRow,
  AdminCreditRow,
  CreditImportResult,
} from '../../types/api';

/**
 * 积分账本 (B-49~B-52)。
 *
 * ## 只增不改的对账基础
 *
 * 余额永远从 `CreditLot` 推导, 流水 (`CreditLedger`) 只追加。所以这里
 * 「余额」与「累计获得/消耗」是两类数: 前者是当前可用 (含已过期扣除),
 * 后者是历史总量。把它们混在一列会让运营以为「余额对不上流水」——
 * 实际上是过期回收与退款扣回不进「累计消耗」。
 *
 * ## 人工调整必须有原因
 *
 * 积分是可变现资产, 无理由的加减无法追责。单条调整与批量调整都强制原因。
 */

/** 流水类型 → 中文。未知类型原样显示, 便于发现未登记的取值 */
const LEDGER_LABELS: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  admin_adjust: '人工调整',
  expire: '到期回收',
  refund_reclaim: '退款扣回',
};

/** 批次来源 → 中文 */
const SOURCE_LABELS: Record<string, string> = {
  purchase: '购买',
  grant: '发放',
  admin_adjust: '人工',
  refund_reclaim: '退款扣回',
};

const LEDGER_OPTIONS = Object.entries(LEDGER_LABELS).map(([value, label]) => ({ value, label }));

/** 带符号的积分文本: 正数显式加号, 否则扫视时看不出是增还是减 */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function fmtTime(v: string | null): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

export function AdminCreditsPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();

  // 深链/刷新后保留筛选。初始值同时喂给 useAdminList, 首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const initialUserId = searchParams.get('userId') ?? '';

  const [email, setEmail] = useState(initialEmail);
  const [userId, setUserId] = useState(initialUserId);

  const [detail, setDetail] = useState<AdminCreditRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminCreditsApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        email: params.email as string | undefined,
        userId: params.userId as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminCreditListResult>(fetcher, {
      email: initialEmail || undefined,
      userId: initialUserId || undefined,
    });

  // 只同步已生效的筛选, 不同步分页
  useAdminUrlFilterSync({
    email: params.email as string | undefined,
    userId: params.userId as string | undefined,
  });

  const rows = data?.items ?? [];

  const pageSummary = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        balance: acc.balance + r.balance,
        expiring: acc.expiring + r.expiringSoon,
      }),
      { balance: 0, expiring: 0 },
    );
  }, [rows]);

  const hasFilter = Boolean(email || userId);

  const applyQuery = () =>
    setQuery({ email: email.trim() || undefined, userId: userId.trim() || undefined });

  const reset = () => {
    setEmail('');
    setUserId('');
    setQuery({ email: undefined, userId: undefined });
  };

  /**
   * 导出走**已生效**的筛选, 而不是输入框里的草稿 ——
   * 用户输入后未点「查询」时, 导出的必须与屏幕上的列表同口径。
   */
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminCreditsApi.exportCsv({
        email: params.email as string | undefined,
        userId: params.userId as string | undefined,
      });
      void message.success('导出已开始下载');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnsType<AdminCreditRow> = [
    {
      title: '用户',
      key: 'user',
      width: 230,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.name || row.email}</span>
          <span className="adm-cell-sub">
            {row.email}
            {row.name ? '' : ' · 无昵称'}
          </span>
          <code className="adm-cell-sub" title={row.userId}>
            {row.userId}
          </code>
        </div>
      ),
    },
    {
      title: '当前余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 110,
      render: (v: number) => <b>{v}</b>,
    },
    {
      title: '30 天内到期',
      dataIndex: 'expiringSoon',
      key: 'expiringSoon',
      width: 120,
      render: (v: number) =>
        v > 0 ? <span className="adm-text-warn">{v}</span> : <span className="adm-cell-sub">—</span>,
    },
    {
      title: '累计获得',
      dataIndex: 'totalEarned',
      key: 'totalEarned',
      width: 100,
    },
    {
      title: '累计消耗',
      dataIndex: 'totalConsumed',
      key: 'totalConsumed',
      width: 100,
    },
    {
      title: '有效批次',
      dataIndex: 'activeLots',
      key: 'activeLots',
      width: 90,
    },
    {
      title: '最近到期',
      dataIndex: 'nearestExpiry',
      key: 'nearestExpiry',
      width: 160,
      render: (v: string | null) => <span className="adm-cell-sub">{fmtTime(v)}</span>,
    },
    {
      title: '',
      key: 'ops',
      width: 80,
      render: (_: unknown, row) => (
        <div className="adm-ops">
          <Button type="link" className="adm-link" onClick={() => setDetail(row)}>
            明细
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="积分账本"
        description="余额由批次推导，流水只追加不修改。人工调整会立即改变用户可用余额并写入审计。"
        actions={
          <div className="adm-ops">
            {can('credit.adjust') && (
              <Button type="default" className="adm-btn" onClick={() => setBatchOpen(true)}>
                <Upload size={14} style={{ marginRight: 4 }} />
                批量调整
              </Button>
            )}
            {/* CSV 导入走邮箱而非用户 ID: 运营手里的补偿名单通常是邮箱表, 不是 cuid */}
            {/* 后端 /admin/credits/import 的权限点是 credit.adjust（导入会改余额，
                与人工调整同一套规则）。此前这里用 data.import，导致有 credit.adjust
                的财务看不到入口，而只有 data.import 的角色点进去反而 403。 */}
            {can('credit.adjust') && (
              <Button type="default" className="adm-btn" onClick={() => setImportOpen(true)}>
                <Upload size={14} style={{ marginRight: 4 }} />
                导入 CSV
              </Button>
            )}
            {can('data.export') && (
              <Button
                type="default"
                className="adm-btn"
                onClick={() => void exportCsv()}
                disabled={exporting}
              >
                <Download size={14} style={{ marginRight: 4 }} />
                {exporting ? '导出中…' : '导出 CSV'}
              </Button>
            )}
          </div>
        }
      />

      <div className="adm-stat-grid">
        <StatCard label="用户总数" value={data?.total ?? '—'} hint="符合当前筛选的账户数" />
        <StatCard label="本页余额合计" value={pageSummary.balance} hint="仅统计当前页，不是全站总量" />
        <StatCard
          label="本页 30 天内到期"
          value={pageSummary.expiring}
          hint="到期会被自动回收，用户可能察觉余额下降"
          tone={pageSummary.expiring > 0 ? 'warn' : undefined}
        />
      </div>

      <FilterBar>
        <Input
          className="adm-filter-input"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onPressEnter={applyQuery}
          allowClear
        />
        <Input
          className="adm-filter-input"
          placeholder="用户 ID（精确）"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onPressEnter={applyQuery}
          allowClear
        />
        <FilterActions>
          <Button type="primary" className="adm-btn is-primary" onClick={applyQuery}>
            查询
          </Button>
          <Button type="default" className="adm-btn" onClick={reset}>
            重置
          </Button>
        </FilterActions>
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel title="用户积分总览" note="按注册时间倒序">
        {loading && !data ? (
          <AdminListLoading tip="加载积分总览…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <AdminEmpty
            description={hasFilter ? '没有符合条件的用户。' : '还没有可查看的用户。'}
            action={
              hasFilter ? (
                <Button type="default" className="adm-btn" onClick={reset}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table<AdminCreditRow>
            rowKey="userId"
            size="small"
            columns={columns}
            dataSource={rows}
            loading={loading}
            scroll={{ x: 1100 }}
            pagination={adminPagination({
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              onChange: setPage,
            })}
          />
        )}
      </Panel>

      {detail && (
        <CreditDetailDrawer
          user={detail}
          writable={can('credit.adjust')}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            // 抽屉里的余额落在 `detail` 快照上, 只 reload 列表不会让它变 ——
            // 刚调完仍显示旧数字, 会被当成"没生效"
            reload();
            try {
              const res = await adminCreditsApi.list({ userId: detail.userId });
              if (res.items[0]) setDetail(res.items[0]);
            } catch {
              // 刷新失败不影响"本次调整已成功"的结论, 静默即可
            }
          }}
        />
      )}

      <BatchAdjustModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onDone={() => {
          setBatchOpen(false);
          reload();
        }}
      />

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          reload();
        }}
      />
    </>
  );
}

/**
 * 单用户明细: 批次 + 流水 + 单条调整。
 *
 * 独立组件而不是把状态塞进页面: 抽屉的批次/流水是「随用户切换而重拉」的数据,
 * 与列表的分页状态生命周期完全不同, 混在一起会让列表重新渲染时抽屉闪一下。
 */
function CreditDetailDrawer({
  user,
  writable,
  onClose,
  onChanged,
}: {
  user: AdminCreditRow;
  writable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [type, setType] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [validDays, setValidDays] = useState('');

  const [busy, setBusy] = useState(false);

  /*
   * 批次与流水一次拉齐: 只看流水不看批次, 看不出「这 30 分是从哪一批扣的」;
   * 分成两次加载会让两块停留在不同时刻的数字上。
   */
  const { data, loading, error, reload } = useAdminResource(
    () =>
      Promise.all([
        adminCreditsApi.lots(user.userId, { from: from || undefined, to: to || undefined }),
        adminCreditsApi.ledger(user.userId, {
          type,
          from: from || undefined,
          to: to || undefined,
          limit: 100,
        }),
      ]),
    [user.userId, type, from, to],
  );
  const lots = data?.[0] ?? [];
  const ledger = data?.[1] ?? [];

  const parsedDelta = Number(delta);
  const deltaValid = Number.isInteger(parsedDelta) && parsedDelta !== 0;

  const submitAdjust = async () => {
    if (!deltaValid) {
      void message.warning('变动量必须是非零整数，正数增加、负数扣减');
      return;
    }
    const trimmed = reason.trim();
    if (!trimmed) {
      void message.warning('请填写调整原因');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.adjust({
        userId: user.userId,
        delta: parsedDelta,
        reason: trimmed,
        ...(validDays.trim() ? { validDays: Number(validDays) } : {}),
      });
      void message.success(`已调整 ${signed(parsedDelta)} 积分，当前余额 ${r.balance}`);
      setDelta('');
      setReason('');
      setValidDays('');
      void reload({ silent: true });
      onChanged();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '调整失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={`积分明细 · ${user.email}`}
      size={760}
      open
      onClose={onClose}
      className="adm-drawer"
      destroyOnHidden
    >
      {error && data && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <div className="adm-section">
        <div className="adm-section-title">账户概要</div>
        <dl className="adm-desc">
          <dt>用户 ID</dt>
          <dd>
            <code>{user.userId}</code>
          </dd>
          <dt>当前余额</dt>
          <dd>
            <b>{user.balance}</b>
          </dd>
          <dt>30 天内到期</dt>
          <dd>{user.expiringSoon}</dd>
          <dt>累计获得 / 消耗</dt>
          <dd>
            {user.totalEarned} / {user.totalConsumed}
            <span className="adm-panel-note">
              {' '}
              不含到期回收与退款扣回，故与余额不构成等式
            </span>
          </dd>
          <dt>最近到期</dt>
          <dd>{fmtTime(user.nearestExpiry)}</dd>
        </dl>
      </div>

      {writable && (
        <div className="adm-section">
          <div className="adm-section-title">
            人工调整
            <span className="adm-panel-note">正数增加、负数扣减；扣减受余额限制</span>
          </div>
          <div className="adm-form">
            <div className="adm-form-row">
              <div className="adm-field">
                <label htmlFor="c-delta">变动量（积分）</label>
                <Input
                  id="c-delta"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="如 100 或 -50"
                  inputMode="numeric"
                />
              </div>
              <div className="adm-field">
                <label htmlFor="c-valid">有效天数（可选）</label>
                <Input
                  id="c-valid"
                  value={validDays}
                  onChange={(e) => setValidDays(e.target.value)}
                  placeholder="留空 = 永久"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="adm-field">
              <label htmlFor="c-reason">调整原因（强制）</label>
              <Input
                id="c-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：工单 #123 补偿生成失败"
                maxLength={200}
              />
            </div>
            <div>
              <Button
                type="primary"
                className="adm-btn is-primary"
                disabled={!deltaValid}
                onClick={() => void submitAdjust()}
              >
                提交调整
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="adm-section">
        <div className="adm-section-title">
          批次
          <span className="adm-panel-note">消耗按先到期先扣（FEFO），空到期视为最晚</span>
        </div>
        {loading && !data ? (
          <AdminListLoading tip="加载积分批次…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : lots.length === 0 ? (
          <AdminEmpty description="该用户没有积分批次。" />
        ) : (
          <Table<AdminCreditLotRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={lots}
            columns={[
              {
                title: '来源',
                dataIndex: 'source',
                key: 'source',
                width: 100,
                render: (v: string) => SOURCE_LABELS[v] ?? v,
              },
              {
                title: '剩余 / 总量',
                key: 'amount',
                width: 140,
                render: (_: unknown, r) => `${r.remainingCredits} / ${r.totalCredits}`,
              },
              {
                title: '到期',
                dataIndex: 'expireAt',
                key: 'expireAt',
                width: 170,
                render: (v: string | null) =>
                  v ? fmtTime(v) : <span className="adm-cell-sub">永久</span>,
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                key: 'createdAt',
                render: (v: string) => fmtTime(v),
              },
            ]}
          />
        )}
      </div>

      <div className="adm-section">
        <div className="adm-section-title">流水</div>
        <FilterBar>
          <Select
            className="adm-filter-select"
            placeholder="类型"
            allowClear
            value={type}
            onChange={setType}
            options={LEDGER_OPTIONS}
          />
          <Input
            className="adm-filter-input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            className="adm-filter-input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <FilterActions>
            <Button type="default" className="adm-btn" loading={loading} onClick={() => void reload()}>
              刷新
            </Button>
          </FilterActions>
        </FilterBar>
        {/*
          流水区不再重复报错: 批次区已经整块显示了同一次加载的失败原因,
          同一个错误在抽屉里出现两次只会让人以为两处各自坏了。
        */}
        {loading && !data ? (
          <AdminListLoading tip="加载积分流水…" />
        ) : error && !data ? null : ledger.length === 0 ? (
          <AdminEmpty description="没有符合条件的流水。" />
        ) : (
          <Table<AdminCreditLedgerRow>
            rowKey="id"
            size="small"
            pagination={false}
            loading={loading}
            dataSource={ledger}
            columns={[
              {
                title: '时间',
                dataIndex: 'createdAt',
                key: 'createdAt',
                width: 170,
                render: (v: string) => fmtTime(v),
              },
              {
                title: '类型',
                dataIndex: 'type',
                key: 'type',
                width: 110,
                render: (v: string) => LEDGER_LABELS[v] ?? v,
              },
              {
                title: '变动',
                dataIndex: 'amount',
                key: 'amount',
                width: 90,
                render: (v: number) => (
                  <b className={v > 0 ? 'adm-text-success' : 'adm-text-danger'}>
                    {signed(v)}
                  </b>
                ),
              },
              {
                title: '变动后余额',
                dataIndex: 'balanceAfter',
                key: 'balanceAfter',
                width: 110,
              },
              {
                title: '说明',
                key: 'reason',
                render: (_: unknown, r) => (
                  <span className="adm-cell-sub">
                    {r.reason ?? '—'}
                    {r.taskId ? ` · 任务 ${r.taskId.slice(-8)}` : ''}
                    {r.orderId ? ` · 订单 ${r.orderId.slice(-8)}` : ''}
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>

    </Drawer>
  );
}

/**
 * 批量调整。
 *
 * 输入格式是「每行 用户ID,变动量[,原因]」而不是动态表单:
 * 运营手里通常是从表格里复制出来的一批 id, 粘进 textarea 比逐行点「添加」
 * 快一个数量级, 也避免了 N 个受控输入各自校验。
 */
function BatchAdjustModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{ userId: string; success: boolean; balance?: number; message?: string }>;
  } | null>(null);

  /** 解析结果与错误行分开返回: 有错行时仍展示能解析的部分, 便于边改边看 */
  const parsed = useMemo(() => {
    const items: Array<{ userId: string; delta: number; reason?: string }> = [];
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
          items.push({
            userId: parts[0],
            delta,
            ...(parts[2] ? { reason: parts[2] } : {}),
          });
        }
      });
    if (items.length > 100) errors.push(`共 ${items.length} 条，单次最多 100 条`);
    return { items, errors };
  }, [text]);

  const close = () => {
    if (busy) return;
    setResult(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      void message.warning('请填写整批调整原因');
      return;
    }
    if (parsed.items.length === 0) {
      void message.warning('没有可提交的有效行');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.batchAdjust({ items: parsed.items, reason: trimmed });
      setResult(r);
      if (r.failed === 0) void message.success(`已调整 ${r.succeeded} 条`);
      else void message.warning(`成功 ${r.succeeded} 条，失败 ${r.failed} 条`);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '批量调整失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="批量调整积分"
      size={680}
      open={open}
      onClose={close}
      className="adm-drawer"
      destroyOnHidden
      footer={
        <div className="adm-drawer-footer">
          <Button type="default" className="adm-btn" onClick={close} disabled={busy}>
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (
            <Button type="primary" className="adm-btn is-primary" onClick={onDone}>
              完成
            </Button>
          ) : (
            <Button
              type="primary"
              className="adm-btn is-primary"
              onClick={() => void submit()}
              disabled={busy || parsed.items.length === 0}
            >
              {busy ? '提交中…' : `提交 ${parsed.items.length} 条`}
            </Button>
          )}
        </div>
      }
    >
      {result ? (
        <div className="adm-section">
          <div className="adm-section-title">
            执行结果
            <span className="adm-panel-note">
              成功 {result.succeeded} · 失败 {result.failed}
            </span>
          </div>
          <Table
            rowKey="userId"
            size="small"
            pagination={false}
            dataSource={result.results}
            columns={[
              {
                title: '用户 ID',
                dataIndex: 'userId',
                key: 'userId',
                render: (v: string) => <code className="adm-cell-sub">{v}</code>,
              },
              {
                title: '结果',
                key: 'ok',
                width: 90,
                render: (_: unknown, r) =>
                  r.success ? (
                    <span className="adm-tag is-success">
                      <span className="adm-tag-dot" aria-hidden="true" />
                      成功
                    </span>
                  ) : (
                    <span className="adm-tag is-danger">
                      <span className="adm-tag-dot" aria-hidden="true" />
                      失败
                    </span>
                  ),
              },
              {
                title: '说明',
                key: 'msg',
                render: (_: unknown, r) => (
                  <span className="adm-cell-sub">
                    {r.success ? `余额 ${r.balance}` : (r.message ?? '未知原因')}
                  </span>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <div className="adm-form">
          <div className="adm-field">
            <label htmlFor="b-lines">调整清单</label>
            <Input.TextArea
              id="b-lines"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'每行一条：用户ID,变动量[,单独原因]\n如：\ncuid_abc,100\ncuid_def,-50,工单 #223 扣回'}
            />
            <div className="adm-field-hint">
              正数增加、负数扣减，单次最多 100 条；逐条独立执行，一条失败不影响其余
            </div>
          </div>

          {parsed.errors.length > 0 && (
            <div className="adm-confirm-warn">
              <span>
                {parsed.errors.slice(0, 5).join('；')}
                {parsed.errors.length > 5 ? ` …共 ${parsed.errors.length} 处问题` : ''}
              </span>
            </div>
          )}

          <div className="adm-field">
            <label htmlFor="b-reason">整批原因（强制）</label>
            <Input
              id="b-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="如：2026-10 故障补偿"
              maxLength={200}
            />
            <div className="adm-field-hint">逐行未填原因时使用该文案；每一条都会写入审计</div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

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
 * 首行可以是表头（`email,delta,reason` / `邮箱,变动量,原因`）, 也可以是
 * 直接的数据行 —— 两种在 Excel 另存为 CSV 的场景里都很常见, 后端两种都认。
 * 逗号分隔、UTF-8（Excel 中文版另存的 CSV 常带 BOM, 后端会剥掉）。
 */
function CsvImportModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [reason, setReason] = useState('');
  const [validDays, setValidDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreditImportResult | null>(null);

  /** 关闭时清空: 下次打开不该看到上次选的文件 */
  const close = () => {
    if (busy) return;
    setFile(null);
    setReason('');
    setValidDays('');
    setResult(null);
    setFileList([]);
    onClose();
  };

  const submit = async () => {
    if (!file) {
      void message.warning('请先选择 CSV 文件');
      return;
    }
    const days = validDays.trim() ? Number(validDays.trim()) : undefined;
    if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
      void message.warning('有效期必须是不小于 1 的整数天');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.importCsv(file, {
        reason: reason.trim() || undefined,
        validDays: days,
      });
      setResult(r);
      if (r.failed === 0) void message.success(`已导入 ${r.succeeded} 条`);
      else void message.warning(`成功 ${r.succeeded} 条，失败 ${r.failed} 条`);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="导入积分（CSV）"
      size={680}
      open={open}
      onClose={close}
      className="adm-drawer"
      destroyOnHidden
      footer={
        <div className="adm-drawer-footer">
          <Button type="default" className="adm-btn" onClick={close} disabled={busy}>
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (
            <Button type="primary" className="adm-btn is-primary" onClick={onDone}>
              完成
            </Button>
          ) : (
            <Button
              type="primary"
              className="adm-btn is-primary"
              onClick={() => void submit()}
              disabled={busy || !file}
            >
              {busy ? '导入中…' : '开始导入'}
            </Button>
          )}
        </div>
      }
    >
      {result ? (
        <div className="adm-section">
          <div className="adm-section-title">
            导入结果
            <span className="adm-panel-note">
              共 {result.total} 行 · 成功 {result.succeeded} · 失败 {result.failed}
            </span>
          </div>
          <Table
            rowKey="row"
            size="small"
            pagination={adminMiniPagination({ pageSize: 10, unit: '行' })}
            dataSource={[...result.results].sort((a, b) => Number(a.success) - Number(b.success))}
            columns={[
              { title: '行号', dataIndex: 'row', key: 'row', width: 70 },
              {
                title: '邮箱',
                dataIndex: 'email',
                key: 'email',
                render: (v: string) => <span className="adm-cell-sub">{v || '—'}</span>,
              },
              {
                title: '变动',
                dataIndex: 'delta',
                key: 'delta',
                width: 90,
                render: (v: number) => (Number.isFinite(v) ? signed(v) : '—'),
              },
              {
                title: '结果',
                key: 'ok',
                width: 90,
                render: (_: unknown, r) =>
                  r.success ? (
                    <span className="adm-tag is-success">
                      <span className="adm-tag-dot" aria-hidden="true" />
                      成功
                    </span>
                  ) : (
                    <span className="adm-tag is-danger">
                      <span className="adm-tag-dot" aria-hidden="true" />
                      失败
                    </span>
                  ),
              },
              {
                title: '说明',
                key: 'msg',
                render: (_: unknown, r) => (
                  <span className="adm-cell-sub">
                    {r.success ? `余额 ${r.balance}` : (r.message ?? '未知原因')}
                  </span>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <div className="adm-form">
          <div className="adm-field">
            <label htmlFor="imp-file">CSV 文件</label>
            <AntUpload
              accept=".csv,text/csv"
              maxCount={1}
              fileList={fileList}
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
              <Button icon={<Upload size={14} />}>选择 CSV</Button>
            </AntUpload>
            <div className="adm-field-hint">
              每行 <code>邮箱,变动量[,原因]</code>，首行可带表头；单次最多 500 行。
              正数增加、负数扣减。
            </div>
          </div>

          <div className="adm-field">
            <label htmlFor="imp-reason">整批原因</label>
            <Input
              id="imp-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="如：2026-10 故障补偿（行内未填原因时使用该文案）"
              maxLength={200}
            />
            <div className="adm-field-hint">会写入每一条的审计记录</div>
          </div>

          <div className="adm-field">
            <label htmlFor="imp-days">有效期（天，可选）</label>
            <Input
              id="imp-days"
              value={validDays}
              onChange={(e) => setValidDays(e.target.value)}
              placeholder="留空表示永久有效"
              inputMode="numeric"
            />
          </div>

          <div className="adm-confirm-warn">
            <span>
              导入会立即改变用户可用余额且不可撤销。建议先用几行小数据验证格式，
              再导全量。
            </span>
          </div>
        </div>
      )}
    </Drawer>
  );
}
