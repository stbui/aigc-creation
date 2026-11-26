import { AdminPage } from './components';
import { GenerationTasksTab } from './GenerationTasksTab';

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 只展示异步 `GenerationTask` 的生命周期。图片转提示词等同步文字调用只写
 * `ApiCallLog`，不创建任务，统一在「调用记录」页按来源 / 操作筛选查看，
 * 不在此伪装成任务行。
 */
export function AdminTasksPage() {
  return (
    <AdminPage
      title="任务监控"
      description="生成任务的生命周期、失败重试与终止；同步文字调用（如 AI 分析）见「调用记录」。"
    >
      <GenerationTasksTab />
    </AdminPage>
  );
}
