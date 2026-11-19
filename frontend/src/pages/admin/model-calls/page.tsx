import { AdminPage } from './components';
import { Detail } from './Detail';
import { Filters } from './Filters';
import { useAdminDetailParam } from './hooks';
import { List } from './List';
import { useModelCallFilters } from './useModelCallFilters';

/**
 * 上游调用记录（`/admin/model-calls`，数据源 `/admin/api-logs`）。
 *
 * 一条记录 = 一次真实的上游 HTTP 调用，包括后台连通性测试（`billable=false`）。
 * 与「生成账单」的区别：账单按任务聚合（一次任务可能包含创建 + 多次轮询），
 * 调用记录逐次留痕，排查「到底哪个请求失败了、返回了什么」看这里。
 *
 * 旧的 `ModelCallLog` 视图随 `src/providers/**` 在 P6 删除；本页已切到
 * `ApiCallLog`，两条链路不能共用同一路径。
 *
 * 页面只负责组合：查询生命周期与 URL 同步在 `useModelCallFilters`，筛选条与
 * 列表各自成组件，详情抽屉由 `?id=` 决定开关，三者互不知道对方的 state。
 */
export function AdminModelCallsPage() {
  const filters = useModelCallFilters();
  const [detailId, setDetailId] = useAdminDetailParam();

  return (
    <AdminPage
      title="调用记录"
      description="逐次留痕的上游 HTTP 调用，含后台连通性测试（不计费）。排查「哪个请求失败、返回了什么」看这里。"
    >
      <Filters
        draft={filters.draft}
        onChange={filters.patchDraft}
        appliedChips={filters.appliedChips}
        onApply={filters.applyFilters}
        onReset={filters.resetFilters}
      />

      <List
        rows={filters.rows}
        loading={filters.loading}
        error={filters.error}
        hasFilter={filters.hasFilter}
        pagination={filters.pagination}
        onRefresh={filters.reload}
        onOpenDetail={setDetailId}
        onResetFilters={filters.resetFilters}
      />

      <Detail detailId={detailId} onClose={() => setDetailId(null)} />
    </AdminPage>
  );
}
