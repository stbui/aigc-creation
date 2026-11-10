import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '~/admin-ui/primitives';
import { AiAnalysisMonitor } from './AiAnalysisMonitor';
import { GenerationTasksTab } from './GenerationTasksTab';
import { useAdmin } from './hooks';

const TABS = [
  { value: 'tasks', label: '生成任务' },
  { value: 'ai-analysis', label: 'AI 分析' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value);
}

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 「生成任务」与「AI 分析」共用值班入口，但数据模型不同：前者是异步
 * GenerationTask，后者是同步文字调用（只有 ApiCallLog，没有任务）。因此
 * AI 分析只读展示真实上游调用，不伪造任务行，也不提供重试 / 终止。
 */
export function AdminTasksPage() {
  const { can } = useAdmin();
  const canReadModelCalls = can('model.call_read');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab: TabValue =
    requestedTab === 'ai-analysis' && canReadModelCalls ? 'ai-analysis' : 'tasks';
  const tabs = TABS.filter((item) => item.value !== 'ai-analysis' || canReadModelCalls);

  const switchTab = useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      if (next === 'ai-analysis' && !canReadModelCalls) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'tasks') params.delete('tab');
          else params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [canReadModelCalls, setSearchParams],
  );

  return (
    <>
      <PageHeader
        title="任务监控"
        description="生成任务的生命周期与同步 AI 分析调用；两类数据分开呈现，避免把同步调用伪装成任务。"
      />

      <Tabs value={tab} onValueChange={switchTab} className="gap-3">
        <TabsList aria-label="任务监控标签" className="h-9 gap-1 p-1">
          {tabs.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-7 px-3 text-sm font-medium"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="tasks">
          <GenerationTasksTab />
        </TabsContent>
        {canReadModelCalls && (
          <TabsContent value="ai-analysis">
            <AiAnalysisMonitor />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
