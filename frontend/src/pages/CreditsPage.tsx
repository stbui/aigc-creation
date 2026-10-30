import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Pagination, Row, Table, Tabs, Tag } from 'antd';
import { ShoppingBag, Wallet } from 'lucide-react';
import { creditsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { PersonalPage } from '../components/PersonalPage';
import { StateButton, StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { CreditBalance, CreditLedgerEntry, CreditLot } from '../types/api';

/**
 * 积分明细 (余额 / 批次 / 流水)。
 *
 * 数据全部来自 `/credits/*`, 前端不做任何加减运算 ——
 * 余额由后端按批次汇总推导, 本地重算会与真实账本对不上。
 *
 * ⚠ 「即将过期」必须单独成列: 积分是**有有效期的批次**而非一坨总额。
 * 只显示总余额会让用户以为积分不会过期, 到期后发现少了会当成系统 bug。
 */

type Tab = 'ledger' | 'lots';

const SOURCE_LABEL: Record<string, string> = {
  purchase: '购买',
  grant: '赠送',
  admin_adjust: '客服调整',
};

const LEDGER_LABEL: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  refund_reclaim: '退款扣回',
  expire: '到期回收',
  admin_adjust: '客服调整',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(iso: string | null | undefined): string {
  if (!iso) return '永久';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

const LOT_STATUS: Record<CreditLot['status'], string> = {
  active: '可用',
  expired: '已过期',
  exhausted: '已用尽',
};

/** 每页条数: 桌面表格与窄屏列表共用, 换结构不改分页节奏 */
const PAGE_SIZE = 20;

/**
 * 流水的备注口径: 后台人工调整的原文可能含工单号 / 客服姓名,
 * C 端只展示枚举文案, 不把内部备注透出给用户。
 */
function ledgerRemark(row: CreditLedgerEntry): string | null {
  if (row.type === 'admin_adjust') return '客服调整';
  return row.reason ?? null;
}

/**
 * 窄屏流水列表。
 *
 * ≤767px 时不再用表格: 五列在 680px 以下必然被卡片右缘切断,
 * 用户看到的是半截「变动」「备注」而不是可以横滚的表。改成两行一条:
 * 第一行类型 + 金额, 第二行时间 + 变动后余额, 备注另起一行。
 */
function LedgerList({ rows }: { rows: CreditLedgerEntry[] }) {
  return (
    <ul className="credits-mobile-list">
      {rows.map((row) => {
        const remark = ledgerRemark(row);
        return (
          <li key={row.id} className="credits-mobile-item">
            <div className="credits-mobile-line">
              <span className="credits-mobile-title">{LEDGER_LABEL[row.type] ?? row.type}</span>
              <span className={`credits-amount ${row.amount >= 0 ? 'is-plus' : 'is-minus'}`}>
                {row.amount >= 0 ? `+${row.amount}` : row.amount}
              </span>
            </div>
            <div className="credits-mobile-meta">
              <span>{formatDate(row.createdAt)}</span>
              <span>变动后余额 {row.balanceAfter}</span>
            </div>
            {remark && <div className="credits-mobile-note">{remark}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** 窄屏批次列表: 来源 + 状态一行, 剩余 / 总额 / 到期日一行 */
function LotList({ rows }: { rows: CreditLot[] }) {
  return (
    <ul className="credits-mobile-list">
      {rows.map((lot) => (
        <li key={lot.id} className="credits-mobile-item">
          <div className="credits-mobile-line">
            <span className="credits-mobile-title">{SOURCE_LABEL[lot.source] ?? lot.source}</span>
            <Tag variant="filled" className={`credits-status is-${lot.status}`}>
              {LOT_STATUS[lot.status] ?? LOT_STATUS.active}
            </Tag>
          </div>
          <div className="credits-mobile-meta">
            <span>
              剩余 {lot.remainingCredits}，共 {lot.totalCredits}
            </span>
            <span>{lot.expireAt ? `${formatDay(lot.expireAt)} 到期` : '长期有效'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CreditsPage() {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const [tab, setTab] = useState<Tab>('ledger');
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
   * 表格在窄屏会被卡片右缘切断, 换成列表渲染 (见 LedgerList / LotList)。
   * 767 是 antd 的 md 边界, 也是 680px 表宽能完整放下的下限。
   */
  const narrow = useMediaQuery('(max-width: 767px)');
  const [ledgerPage, setLedgerPage] = useState(1);
  const [lotsPage, setLotsPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 三个接口并发取, 任一失败不阻断其余两个 ——
      // 余额取不到时用户仍该看到批次与流水
      const [b, l, k] = await Promise.allSettled([
        creditsApi.balance(),
        creditsApi.ledger(100),
        creditsApi.lots(),
      ]);
      if (b.status === 'fulfilled') setBalance(b.value);
      if (l.status === 'fulfilled') {
        setLedger(l.value);
        // 重新取数后回到第一页, 免得停在一个已经不存在的页码上
        setLedgerPage(1);
      }
      if (k.status === 'fulfilled') {
        setLots(k.value);
        setLotsPage(1);
      }
      if (b.status === 'rejected' && l.status === 'rejected') {
        setError((b.reason as Error)?.message || '积分数据加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 依赖 token: 登录 / 退出都要重取 (与 StatsPage 同构)
  useEffect(() => {
    if (!token) {
      // guest: 三个积分接口都要鉴权, 不发就会连着 401 且渲染成「加载失败」
      setBalance(null);
      setLedger([]);
      setLots([]);
      setLoading(false);
      return;
    }
    void load();
  }, [token, load]);

  /*
   * guest 态: 路由对外开放, 未登录进 /credits 时此前会把三个接口的 401
   * 渲染成「积分数据加载失败」—— 用户以为系统坏了, 实际只是没登录。
   */
  if (!token) {
    return (
      <PersonalPage title="积分明细" description="查看余额、批次与每一笔积分流水。">
        <StateEmpty
          title="登录后查看积分明细"
          desc="积分余额、批次与流水均与账号绑定，登录后即可查看。"
          action={
            <StateButton onClick={openLogin}>登录/注册</StateButton>
          }
        />
      </PersonalPage>
    );
  }

  const ledgerColumns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string | null) => formatDate(value),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (value: string) => LEDGER_LABEL[value] ?? value,
    },
    {
      title: '变动',
      dataIndex: 'amount',
      width: 110,
      align: 'right' as const,
      render: (value: number) => (
        <span className={`credits-amount ${value >= 0 ? 'is-plus' : 'is-minus'}`}>
          {value >= 0 ? `+${value}` : value}
        </span>
      ),
    },
    {
      // 这是该笔变动**发生当时**的快照, 不等于当前余额；
      // 列名叫「余额」会让用户拿它和顶部的 3805 对照, 误以为账错了。
      title: '变动后余额',
      dataIndex: 'balanceAfter',
      width: 110,
      align: 'right' as const,
    },
    {
      title: '备注',
      dataIndex: 'reason',
      ellipsis: true,
      /*
       * 后台人工调整的 reason 是运营填写的内部备注，可能含工单号、客服姓名。
       * C 端只展示枚举文案，不把内部原文透出给用户。
       */
      render: (_value: string | null, row: CreditLedgerEntry) => ledgerRemark(row) ?? '—',
    },
  ];

  const lotColumns = [
    {
      title: '来源',
      dataIndex: 'source',
      width: 130,
      render: (value: string) => SOURCE_LABEL[value] ?? value,
    },
    { title: '总额', dataIndex: 'totalCredits', width: 100, align: 'right' as const },
    { title: '剩余', dataIndex: 'remainingCredits', width: 100, align: 'right' as const },
    {
      title: '到期日',
      dataIndex: 'expireAt',
      width: 140,
      render: (value: string | null) => formatDay(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: CreditLot['status']) => {
        // 不用 antd 的 success / error 预设色: 默认绿字在淡绿底上只有 2.41:1,
        // 状态色统一走 .credits-status 的深色前景。
        return (
          <Tag variant="filled" className={`credits-status is-${value}`}>
            {LOT_STATUS[value] ?? LOT_STATUS.active}
          </Tag>
        );
      },
    },
  ];

  const stats = [
    /*
     * 不再放「可用余额」：上面的 hero 已经给了同一个数，两张卡片并排
     * 重复 3805 只会让页面看起来像两套账。这里换成批次数，回答 hero
     * 那个数字是由几笔积分拼出来的。
     */
    { label: '可用批次', value: balance?.activeLots },
    { label: '累计获得', value: balance?.totalEarned },
    /*
     * 后端 totalConsumed 只统计 type='consume' 的流水（人工扣减走 admin_adjust、
     * 退款扣回走 refund_reclaim、到期走 expire，都不计入）。标成「累计消耗」会
     * 让人拿「获得 - 消耗」去对余额，一旦有到期或人工扣减就对不上；
     * 用「生成消耗」与流水里的类型名一致。
     */
    { label: '生成消耗', value: balance?.totalConsumed },
    { label: '30 天内到期', value: balance?.expiringSoon, warn: (balance?.expiringSoon ?? 0) > 0 },
  ];

  // 窄屏列表自己分页; 桌面表格沿用 antd 内部的分页状态
  const ledgerView = ledger.slice((ledgerPage - 1) * PAGE_SIZE, ledgerPage * PAGE_SIZE);
  const lotsView = lots.slice((lotsPage - 1) * PAGE_SIZE, lotsPage * PAGE_SIZE);

  return (
    <PersonalPage
      className="credits-page"
      title="积分明细"
      description="积分按批次发放并可能有有效期；余额由后端账本实时汇总。"
      extra={
        <Button type="primary" icon={<ShoppingBag size={15} />} onClick={() => navigate('/packages')}>
          购买积分 / 会员
        </Button>
      }
    >
      <Card className="credits-hero" variant="borderless">
        <div className="credits-hero-main">
          <span className="credits-hero-icon" aria-hidden>
            <Wallet size={22} />
          </span>
          <div>
            <div className="credits-hero-label">当前可用积分</div>
            <div className="credits-hero-value">{balance?.balance ?? '—'}</div>
            <div className="credits-hero-note">
              {balance && balance.activeLots > 0 ? (
                <>
                  {balance.nearestExpiry
                    ? `最近一笔将于 ${formatDay(balance.nearestExpiry)} 到期，`
                    : '积分永久有效，'}
                  <span className="credits-hero-rule">积分按到期先后扣减</span>
                </>
              ) : (
                '暂无可用批次，购买积分或开通会员后即可使用'
              )}
            </div>
          </div>
        </div>
        {/*
         * 只在真的有积分将要到期时才占位。没有到期项时这里原本写着
         * 「暂无即将到期的积分」，和下面「30 天内到期 0」是同一句话，
         * 还会在窄屏折行后把 hero 撑成两段。
         */}
        {balance && balance.expiringSoon > 0 && balance.nearestExpiry && (
          <div className="credits-hero-side">
            <span className="credits-hero-warn">
              {balance.expiringSoon} 积分将于 {formatDay(balance.nearestExpiry)} 到期
            </span>
          </div>
        )}
      </Card>

      <Row gutter={[12, 12]} className="credits-stats">
        {stats.map((item) => (
          <Col xs={12} sm={6} key={item.label}>
            <Card size="small" className="credits-stat-card">
              <div className="credits-stat-label">{item.label}</div>
              <div className={`credits-stat-value${item.warn ? ' is-warn' : ''}`}>
                {item.value ?? '—'}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="credits-list-card">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
          items={[
            {
              key: 'ledger',
              label: '积分流水',
              children: loading ? (
                <StateSkeleton variant="row" count={5} />
              ) : error ? (
                <StateError
                  title="积分数据加载失败"
                  desc="没能取回积分流水与批次信息。可能是后端未启动或网络异常，重试一次即可。"
                  detail={error}
                  onRetry={() => void load()}
                />
              ) : ledger.length === 0 ? (
                <StateEmpty
                  compact
                  title="还没有积分流水"
                  desc="购买积分、开通会员或完成签到后，每一笔变动都会记录在这里。"
                  action={<StateButton onClick={() => navigate('/packages')}>去获取积分</StateButton>}
                />
              ) : narrow ? (
                <>
                  <LedgerList rows={ledgerView} />
                  {ledger.length > PAGE_SIZE && (
                    <div className="credits-mobile-pager">
                      <Pagination
                        simple
                        size="small"
                        current={ledgerPage}
                        pageSize={PAGE_SIZE}
                        total={ledger.length}
                        onChange={setLedgerPage}
                      />
                    </div>
                  )}
                </>
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  columns={ledgerColumns}
                  dataSource={ledger}
                  pagination={{ pageSize: PAGE_SIZE, hideOnSinglePage: true, showSizeChanger: false }}
                  scroll={{ x: 680 }}
                />
              ),
            },
            {
              key: 'lots',
              label: '批次明细',
              children: loading ? (
                <StateSkeleton variant="row" count={3} />
              ) : error ? (
                <StateError
                  title="积分数据加载失败"
                  desc="没能取回积分批次。可能是后端未启动或网络异常，重试一次即可。"
                  detail={error}
                  onRetry={() => void load()}
                />
              ) : lots.length === 0 ? (
                <StateEmpty
                  compact
                  title="还没有积分批次"
                  desc="每次购买或发放都会形成一个有有效期的积分批次。"
                  action={<StateButton onClick={() => navigate('/packages')}>去获取积分</StateButton>}
                />
              ) : narrow ? (
                <>
                  <LotList rows={lotsView} />
                  {lots.length > PAGE_SIZE && (
                    <div className="credits-mobile-pager">
                      <Pagination
                        simple
                        size="small"
                        current={lotsPage}
                        pageSize={PAGE_SIZE}
                        total={lots.length}
                        onChange={setLotsPage}
                      />
                    </div>
                  )}
                </>
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  columns={lotColumns}
                  dataSource={lots}
                  pagination={{ pageSize: PAGE_SIZE, hideOnSinglePage: true, showSizeChanger: false }}
                  scroll={{ x: 620 }}
                />
              ),
            },
          ]}
        />
      </Card>
    </PersonalPage>
  );
}
