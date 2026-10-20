import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { creditsApi } from '../lib/api';
import { StateError, StateSkeleton } from '../components/StateViews';
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

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="credits-page">
      <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={14} /> 返回
      </button>

      <div className="credits-balance-card">
        <div className="credits-stat">
          <div className="credits-stat-label">可用余额</div>
          <div className="credits-stat-value">{balance?.balance ?? '—'}</div>
        </div>
        <div className="credits-stat">
          <div className="credits-stat-label">累计获得</div>
          <div className="credits-stat-value">{balance?.totalEarned ?? '—'}</div>
        </div>
        <div className="credits-stat">
          <div className="credits-stat-label">累计消耗</div>
          <div className="credits-stat-value">{balance?.totalConsumed ?? '—'}</div>
        </div>
        <div className="credits-stat">
          <div className="credits-stat-label">30 天内到期</div>
          {/* 有临期积分才标黄 —— 常亮告警色等于没有告警 */}
          <div className={`credits-stat-value${(balance?.expiringSoon ?? 0) > 0 ? ' is-warn' : ''}`}>
            {balance?.expiringSoon ?? '—'}
          </div>
        </div>
      </div>

      {balance && balance.expiringSoon > 0 && balance.nearestExpiry && (
        <p className="pkg-pay-hint" style={{ textAlign: 'left', marginBottom: 16 }}>
          有 {balance.expiringSoon} 积分将于 {formatDay(balance.nearestExpiry)} 到期，建议优先使用。
        </p>
      )}

      <div className="credits-tabs">
        <button
          type="button"
          className={`credits-tab${tab === 'ledger' ? ' is-active' : ''}`}
          onClick={() => setTab('ledger')}
        >
          积分流水
        </button>
        <button
          type="button"
          className={`credits-tab${tab === 'lots' ? ' is-active' : ''}`}
          onClick={() => setTab('lots')}
        >
          批次明细
        </button>
      </div>

      {/*
        加载 / 失败 / 空 三态必须分开。

        2026-10-20 修: 此前三者共用 `.credits-list-empty` 一个 class —— 同一句
        「正在加载…」与「还没有积分流水」长得一模一样 (只有文字颜色不同),
        失败时更糟: 直接把错误信息塞进这个 class, 渲染成一句灰字,
        用户既不知道是"没数据"还是"没连上", 也没有重试入口。
      */}
      {loading && <StateSkeleton variant="row" count={5} />}
      {!loading && error && (
        <StateError
          title="积分数据加载失败"
          desc="没能取回积分流水与批次信息。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      )}

      {!loading && !error && tab === 'ledger' && (
        ledger.length === 0 ? (
          <p className="credits-list-empty">还没有积分流水</p>
        ) : (
          <table className="credits-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>变动</th>
                <th>余额</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.createdAt)}</td>
                  <td>{LEDGER_LABEL[e.type] ?? e.type}</td>
                  <td>
                    {/* 有符号: 正为获得, 负为消耗 */}
                    <span className={`credits-amount ${e.amount >= 0 ? 'is-plus' : 'is-minus'}`}>
                      {e.amount >= 0 ? `+${e.amount}` : e.amount}
                    </span>
                  </td>
                  <td>{e.balanceAfter}</td>
                  <td>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {!loading && !error && tab === 'lots' && (
        lots.length === 0 ? (
          <p className="credits-list-empty">还没有积分批次</p>
        ) : (
          <table className="credits-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>总额</th>
                <th>剩余</th>
                <th>到期日</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const st = LOT_STATUS[l.status] ?? LOT_STATUS.active;
                return (
                  <tr key={l.id}>
                    <td>{SOURCE_LABEL[l.source] ?? l.source}</td>
                    <td>{l.totalCredits}</td>
                    <td>{l.remainingCredits}</td>
                    <td>{formatDay(l.expireAt)}</td>
                    <td style={{ color: st.color, fontWeight: 600 }}>{st.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}