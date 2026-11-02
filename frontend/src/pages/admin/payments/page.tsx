import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { ActionButton, Notice, PageHeader, SegmentedTabs } from './components';
import { PaymentsProvidersTab } from './PaymentsProvidersTab';
import { PaymentsProductsTab } from './PaymentsProductsTab';
import { PaymentsOrdersTab } from './PaymentsOrdersTab';
import { PaymentsReconciliationTab } from './PaymentsReconciliationTab';

/**
 * 支付充值页（`/admin/payments`）。
 *
 * 四个标签：支付渠道 / 充值商品 / 支付订单 / 支付对账。
 *
 * 旧版是两个页面（`/admin/payment-channels` 只读渠道状态 + `/admin/reconciliation`
 * 人工导入账单），后端支付域重构后旧控制器已删除、两个页面必然报错。收成
 * 一个四标签页是因为四件事共享同一份「支付域」口径：渠道配置决定能不能收钱，
 * 商品决定卖什么，订单是钱的事实，对账是钱与事实的核对。拆成四个侧栏入口
 * 会让人以为它们互相独立。
 *
 * **URL 是标签的事实源**：`?tab=` 决定显示哪个标签，浏览器前进后退能正确
 * 回到上一个标签；订单与对账的深链参数（`orderId` / `runId`）也写在同一个
 * URL 上，刷新可复原。
 */

/** 合法标签白名单；非法值一律回落到第一个 */
const TABS = [
  { value: 'providers', label: '支付渠道' },
  { value: 'products', label: '充值商品' },
  { value: 'orders', label: '支付订单' },
  { value: 'reconciliation', label: '支付对账' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value);
}

export function AdminPaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: TabValue = isTab(rawTab) ? rawTab : 'providers';

  const [refreshNonce, setRefreshNonce] = useState(0);

  const switchTab = useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="支付充值"
        description="管理系统支付适配器、充值商品、支付订单与 T+1 对账"
        actions={
          <ActionButton
            icon={RefreshCw}
            onClick={() => setRefreshNonce((n) => n + 1)}
            ariaLabel="刷新当前标签"
          >
            刷新
          </ActionButton>
        }
      />

      <Notice tone="info" title="退款请到订单管理">
        本页不提供退款。管理端提供查单、关单和对账：关单前始终先向渠道查单；
        对账发现已支付未入账订单时会幂等补发积分。
      </Notice>

      <div className="mb-4">
        <SegmentedTabs
          value={tab}
          onChange={switchTab}
          options={TABS.map((t) => ({ value: t.value, label: t.label }))}
          ariaLabel="支付域标签"
        />
      </div>

      {/*
       * 四个标签各自持有 loading/error/data，切换标签不互相清空。
       *
       * `refreshNonce` 作为 prop 下传而不是当 `key`：remount 会把筛选与分页
       * 一起重置，而「刷新」的语义是**重取当前筛选下的数据**，不是回到初始态。
       * 各标签在 nonce 变化时调自己的 reload()，筛选条件原样保留。
       */}
      {tab === 'providers' && <PaymentsProvidersTab refreshNonce={refreshNonce} />}
      {tab === 'products' && <PaymentsProductsTab refreshNonce={refreshNonce} />}
      {tab === 'orders' && <PaymentsOrdersTab refreshNonce={refreshNonce} />}
      {tab === 'reconciliation' && (
        <PaymentsReconciliationTab refreshNonce={refreshNonce} />
      )}
    </div>
  );
}
