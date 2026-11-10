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
          {testing ? '测试中…' : '测试服务连通'}
        </ActionButton>
        <span className="text-[12px] text-muted-foreground">
          使用当前表单配置与已保存的访问凭证发起一次最小请求，未保存的修改也会被测试；可能产生费用，但不会创建任务或扣除用户积分。
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
              { label: '接口', value: testResult.request?.protocol ?? '—' },
              { label: '错误', value: testResult.error || testResult.message || '—' },
              { label: '调用记录', value: testResult.logId || '—' },
            ]}
          />
        </Notice>
      )}
    </>
  );
}
