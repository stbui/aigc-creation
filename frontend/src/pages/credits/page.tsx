import { useNavigate } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';

import { CREDITS_PAGE_META, type Tab } from './constants';
import { Button, Card, PersonalPage, StateButton, StateEmpty, Tabs } from './components';
import { useAuth, useCreditsData, useDocumentMeta, useMediaQuery } from './hooks';
import { CreditsHero } from './CreditsHero';
import { CreditsLedgerPanel } from './CreditsLedgerPanel';
import { CreditsLotPanel } from './CreditsLotPanel';
import { CreditsStatsGrid } from './CreditsStatsGrid';

/**
 * 积分明细 (余额 / 批次 / 流水)。
 *
 * 数据全部来自 `/credits/*`, 前端不做任何加减运算 ——
 * 余额由后端按批次汇总推导, 本地重算会与真实账本对不上。
 *
 * ⚠ 「即将过期」必须单独成列: 积分是**有有效期的批次**而非一坨总额。
 * 只显示总余额会让用户以为积分不会过期, 到期后发现少了会当成系统 bug。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：余额 `CreditsHero`、汇总
 * `CreditsStatsGrid`、两个页签 `CreditsLedgerPanel` / `CreditsLotPanel`
 * （窄屏列表 `CreditsLedgerList` / `CreditsLotList`）；账本取数与筛选分页落
 * `hooks.ts` 的 `useCreditsData`。
 */
export function CreditsPage() {
  useDocumentMeta('积分明细 · 货觉AI', '查看积分余额、批次与每一笔流水。');
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  /*
   * 表格在窄屏会被卡片右缘切断, 换成列表渲染 (见 CreditsLedgerList / CreditsLotList)。
   * 767 是兼容层的 md 边界；表格加列后桌面段靠 Table 的横向滚动兜住，
   * 不再要求整表塞进 767px。
   */
  const narrow = useMediaQuery('(max-width: 767px)');
  const {
    tab,
    setTab,
    balance,
    ledger,
    ledgerTotal,
    ledgerLoading,
    ledgerError,
    ledgerFilter,
    handleLedgerFilterChange,
    lots,
    loading,
    error,
    ledgerPage,
    lotsPage,
    setLotsPage,
    loadLedgerPage,
    retryLedger,
    retryAll,
  } = useCreditsData(token);

  /*
   * guest 态: 路由对外开放, 未登录进 /credits 时此前会把三个接口的 401
   * 渲染成「积分数据加载失败」—— 用户以为系统坏了, 实际只是没登录。
   */
  if (!token) {
    return (
      <PersonalPage
        title={CREDITS_PAGE_META.title}
        description={CREDITS_PAGE_META.guestDescription}
      >
        <StateEmpty
          title="登录后查看积分明细"
          desc="积分余额、批次与流水均与账号绑定，登录后即可查看。"
          action={<StateButton onClick={openLogin}>登录/注册</StateButton>}
        />
      </PersonalPage>
    );
  }

  return (
    <PersonalPage
      className="credits-page"
      title={CREDITS_PAGE_META.title}
      description={CREDITS_PAGE_META.description}
      extra={
        <Button type="primary" icon={<ShoppingBag size={15} />} onClick={() => navigate('/packages')}>
          购买积分 / 会员
        </Button>
      }
    >
      <CreditsHero balance={balance} />
      <CreditsStatsGrid balance={balance} />

      <Card className="credits-list-card">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
          items={[
            {
              key: 'ledger',
              label: '积分流水',
              children: (
                <CreditsLedgerPanel
                  rows={ledger}
                  total={ledgerTotal}
                  initialLoading={loading}
                  tableLoading={ledgerLoading}
                  error={ledgerError}
                  filter={ledgerFilter}
                  narrow={narrow}
                  page={ledgerPage}
                  onFilterChange={handleLedgerFilterChange}
                  onPageChange={(page) => void loadLedgerPage(page, ledgerFilter)}
                  onRetry={retryLedger}
                  onGoPackages={() => navigate('/packages')}
                />
              ),
            },
            {
              key: 'lots',
              label: '批次明细',
              children: (
                <CreditsLotPanel
                  lots={lots}
                  initialLoading={loading}
                  error={error}
                  narrow={narrow}
                  page={lotsPage}
                  onPageChange={setLotsPage}
                  onRetry={retryAll}
                  onGoPackages={() => navigate('/packages')}
                />
              ),
            },
          ]}
        />
      </Card>
    </PersonalPage>
  );
}
