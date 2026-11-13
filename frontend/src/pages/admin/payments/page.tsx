import { useCallback, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  AdminPage,
  AdminTabs,
  RefreshButton,
  TabsContent,
} from '~/admin-ui/primitives';
import { PaymentsProvidersTab } from './PaymentsProvidersTab';
import { PaymentsReconciliationTab } from './PaymentsReconciliationTab';
import { PaymentsExceptionPanel } from './PaymentsExceptionPanel';

/**
 * 支付工作台（`/admin/payments`）。
 *
 * 三个标签：收款设置 / 交易核对 / 异常处理。
 *
 * 旧版是两个页面（`/admin/payment-channels` 只读渠道状态 + `/admin/reconciliation`
 * 人工导入账单），后端支付域重构后旧控制器已删除、两个页面必然报错。收成
 * 一个工作台是因为这些事共享同一份「支付域」口径：收款设置决定能不能收钱，
 * 交易核对是钱与事实的核对，异常处理承接需要人工跟进的资金问题。侧栏仍把
 * 三件事拆成独立入口，用户可以从菜单直达；页内标签只负责快速切换。
 *
 * **商品与订单都不在这里**：
 *   · 充值商品就是 `Product` 表，与「商品管理」（`/admin/products`）同一份数据；
 *   · 支付订单就是 `Order` 表，与「订单管理」（`/admin/orders`）同一份数据。
 * 两处各有一套列表/表单时，字段集与动作必然分叉（一边能退款、一边只能查单），
 * 运营会按页面而不是按数据判断状态。商品统一走 `/admin/products`，订单与
 * 渠道查单/关单统一走 `/admin/orders`；本页只保留收款、核对、异常三件事。
 *
 * **URL 是标签的事实源**：`?tab=` 决定显示哪个标签，浏览器前进后退能正确
 * 回到上一个标签；核对的深链参数（`runId`）也写在同一个 URL 上，刷新可复原。
 */

/** 合法标签白名单；非法值一律回落到第一个。`products` / `orders` 旧链接回落到收款设置。 */
const TABS = [
  { value: 'providers', label: '收款设置' },
  { value: 'reconciliation', label: '交易核对' },
  { value: 'exceptions', label: '异常处理' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

const TAB_COPY: Record<TabValue, { title: string; description: string }> = {
  providers: {
    title: '收款设置',
    description: '配置客户可用的收款渠道与支付方式',
  },
  reconciliation: {
    title: '交易核对',
    description: '核对渠道流水与系统订单，跟进对账差异',
  },
  exceptions: {
    title: '异常处理',
    description: '处理支付异常与退款兜底，闭环资金问题',
  },
};

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

  // 侧栏菜单以 `tab=providers` 作为收款设置的规范地址。旧书签或不带
  // 标签参数的入口先补齐参数，避免页面已渲染但侧栏没有选中项。
  if (!isTab(rawTab)) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'providers');
    return <Navigate to={`/admin/payments?${params.toString()}`} replace />;
  }

  const pageCopy = TAB_COPY[tab];

  return (
    <AdminPage
      title={pageCopy.title}
      description={pageCopy.description}
      actions={
        <RefreshButton
          variant="outline"
          label="刷新状态"
          onRefresh={() => setRefreshNonce((n) => n + 1)}
          ariaLabel="刷新当前支付视图"
        />
      }
    >
      <AdminTabs value={tab} onValueChange={switchTab} items={TABS} ariaLabel="支付配置视图">
        {/*
         * 筛选条件与详情深链都在地址栏，切回标签时能恢复；标签未激活时不挂载
         * （Radix 默认），离开标签即释放各自的数据与分页状态，避免进页就并发
         * 拉三份列表。
         *
         * `refreshNonce` 作为 prop 下传而不是当 `key`：remount 会把筛选与分页
         * 一起重置，而「刷新」的语义是**重取当前筛选下的数据**，不是回到初始态。
         * 各标签只在 nonce 变化时调自己的 reload()，筛选条件原样保留。
         */}
        <TabsContent value="providers">
          <PaymentsProvidersTab refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="reconciliation">
          <PaymentsReconciliationTab refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="exceptions">
          <PaymentsExceptionPanel refreshNonce={refreshNonce} />
        </TabsContent>
      </AdminTabs>
    </AdminPage>
  );
}
