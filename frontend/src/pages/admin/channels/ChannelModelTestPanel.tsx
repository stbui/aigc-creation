import { Zap } from 'lucide-react';
import { ActionButton, Descriptions, Notice } from '~/admin-ui/primitives';
import type { ProtocolTestResultView } from '../../../types/model';

export function ChannelModelTestPanel({
  testResult,
  testing,
  onTest,
}: {
  testResult: ProtocolTestResultView | null;
  testing: boolean;
  onTest: () => Promise<void>;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <ActionButton
          variant="secondary"
          size="sm"
          icon={Zap}
          disabled={testing}
          onClick={() => void onTest()}
        >
          {testing ? '测试中…' : '连通性测试'}
        </ActionButton>
        <span className="text-[12px] text-muted-foreground">
          用渠道已保存凭证向上游发一次最小请求，可能产生供应商费用；不建任务、不扣用户积分，结果记入调用记录（非计费）。
        </span>
      </div>

      {testResult && (
        <Notice
          tone={testResult.status === 'succeeded' ? 'success' : 'danger'}
          title={testResult.status === 'succeeded' ? '测试通过' : '测试失败'}
        >
          <Descriptions
            columns={2}
            items={[
              { label: '耗时', value: `${testResult.durationMs}ms` },
              { label: '协议', value: testResult.request?.protocol ?? '—' },
              { label: '错误', value: testResult.error || testResult.message || '—' },
              { label: '调用记录', value: testResult.logId || '—' },
            ]}
          />
        </Notice>
      )}
    </>
  );
}
