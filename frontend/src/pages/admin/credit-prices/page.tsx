import { PageHeader } from '~/admin-ui/primitives';
import { CapabilityPricingPanel } from '../logical-models/CapabilityPricingPanel';

/**
 * 旧「能力消耗价」页面出口。
 *
 * 后台路由已把 `/admin/credit-prices` 重定向到
 * `/admin/capabilities?tab=pricing`；这里保留一个薄包装，避免任何直接引用
 * 旧模块的调用方拿到重复实现。实际表格、草稿与权限逻辑都在合并后的面板里。
 */
export function AdminCreditPricesPage() {
  return (
    <>
      <PageHeader
        title="能力消耗价"
        description="每次生成实际扣除的积分；保存后立即对 C 端展示与生成扣费生效。"
      />
      <CapabilityPricingPanel />
    </>
  );
}
