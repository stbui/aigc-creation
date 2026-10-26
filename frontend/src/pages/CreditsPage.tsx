import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Row, Table, Tabs, Tag } from 'antd';
import { ShoppingBag, Wallet } from 'lucide-react';
import { creditsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
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
  admin_adjust: '人工调整',
};

const LEDGER_LABEL: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  refund_reclaim: '退款扣回',
  expire: '到期回收',
  admin_adjust: '人工调整',
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

const LOT_STATUS: Record<CreditLot['status'], { label: string; color: string }> = {
  active: { label: '可用', color: '#18a875' },
  expired: { label: '已过期', color: '#e5484d' },
  exhausted: { label: '已用尽', color: '#86909c' },
};

export function CreditsPage() {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const [tab, setTab] = useState<Tab>('ledger');
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (l.status === 'fulfilled') setLedger(l.value);
      if (k.status === 'fulfilled') setLots(k.value);
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
      title: '余额',
      dataIndex: 'balanceAfter',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '备注',
      dataIndex: 'reason',
      ellipsis: true,
      render: (value: string | null) => value ?? '—',
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
        const status = LOT_STATUS[value] ?? LOT_STATUS.active;
        return <Tag color={value === 'active' ? 'success' : value === 'expired' ? 'error' : 'default'}>{status.label}</Tag>;
      },
    },
  ];

  const stats = [
    { label: '可用余额', value: balance?.balance, emphasis: true },
    { label: '累计获得', value: balance?.totalEarned },
    { label: '累计消耗', value: balance?.totalConsumed },
    { label: '30 天内到期', value: balance?.expiringSoon, warn: (balance?.expiringSoon ?? 0) > 0 },
  ];

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
              {balance && balance.activeLots > 0
                ? `来自 ${balance.activeLots} 个可用批次，支付成功后积分立即到账`
                : '暂无可用批次，购买积分或开通会员后即可使用'}
            </div>
          </div>
        </div>
        <div className="credits-hero-side">
          {balance && balance.expiringSoon > 0 && balance.nearestExpiry ? (
            <span className="credits-hero-warn">
              {balance.expiringSoon} 积分将于 {formatDay(balance.nearestExpiry)} 到期
            </span>
          ) : (
            <span className="credits-hero-ok">暂无即将到期的积分</span>
          )}
        </div>
      </Card>

      <Row gutter={[12, 12]} className="credits-stats">
        {stats.map((item) => (
          <Col xs={12} sm={6} key={item.label}>
            <Card size="small" className={`credits-stat-card${item.emphasis ? ' is-emphasis' : ''}`}>
              <div className="credits-stat-label">{item.label}</div>
              <div className={`credits-stat-value${item.warn ? ' is-warn' : ''}`}>
                {item.value ?? '—'}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="credits-list-card" title="积分明细">
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
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  columns={ledgerColumns}
                  dataSource={ledger}
                  pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
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
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  columns={lotColumns}
                  dataSource={lots}
                  pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
                  scroll={{ x: 620 }}
                />
              ),
            },
          ]}
        />
      </Card>

      {error && !loading && (
        <Alert
          type="warning"
          showIcon
          message="部分积分数据未能加载"
          description="余额与流水可能不完整，刷新页面或稍后重试即可恢复。"
        />
      )}
    </PersonalPage>
  );
}
