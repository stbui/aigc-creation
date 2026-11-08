import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PageHeader,
  RefreshButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '~/admin-ui/primitives';
import { PaymentsProvidersTab } from './PaymentsProvidersTab';
import { PaymentsProductsTab } from './PaymentsProductsTab';
import { PaymentsOrdersTab } from './PaymentsOrdersTab';
import { PaymentsReconciliationTab } from './PaymentsReconciliationTab';
import { PaymentsExceptionPanel } from './PaymentsExceptionPanel';

/**
 * 支付充值页（`/admin/payments`）。
 *
 * 五个标签：支付渠道 / 充值商品 / 支付订单 / 支付对账 / 支付异常。
 *
 * 旧版是两个页面（`/admin/payment-channels` 只读渠道状态 + `/admin/reconciliation`
 * 人工导入账单），后端支付域重构后旧控制器已删除、两个页面必然报错。收成
 * 一个五标签页是因为这些事共享同一份「支付域」口径：渠道配置决定能不能收钱，
 * 商品决定卖什么，订单是钱的事实，对账是钱与事实的核对，异常队列承接需要
 * 人工兜底的支付事件。拆成多个侧栏入口会让人以为它们互相独立。
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
  { value: 'exceptions', label: '支付异常' },
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
        description="支付渠道、充值商品、支付订单与 T+1 对账；退款请到订单管理"
        actions={
          <RefreshButton
            variant="default"
            onRefresh={() => setRefreshNonce((n) => n + 1)}
            ariaLabel="刷新当前标签"
          />
        }
      />

      <Tabs value={tab} onValueChange={switchTab} className="gap-3">
        <TabsList aria-label="支付域标签" className="h-9 gap-1 p-1">
          {TABS.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-7 px-3 text-sm font-medium"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/*
         * 筛选条件与详情深链都在地址栏，切回标签时能恢复；标签未激活时不挂载
         * （Radix 默认），离开标签即释放各自的数据与分页状态，避免进页就并发
         * 拉五份列表。
         *
         * `refreshNonce` 作为 prop 下传而不是当 `key`：remount 会把筛选与分页
         * 一起重置，而「刷新」的语义是**重取当前筛选下的数据**，不是回到初始态。
         * 各标签只在 nonce 变化时调自己的 reload()，筛选条件原样保留。
         */}
        <TabsContent value="providers">
          <PaymentsProvidersTab refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="products">
          <PaymentsProductsTab refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="orders">
          <PaymentsOrdersTab refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="reconciliation">
          <PaymentsReconciliationTab refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="exceptions">
          <PaymentsExceptionPanel refreshNonce={refreshNonce} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
