import { Descriptions, Panel, StatusTag } from '~/admin-ui/primitives';
import type { ProtocolTestResultView } from '../../../types/model';

export function ChannelModelTestResultPanel({ testResult }: { testResult: ProtocolTestResultView }) {
  return (
    <Panel title="最近一次测试结果" note={`调用记录 ${testResult.logId || '—'}（非计费）`}>
      <Descriptions
        columns={2}
        items={[
          {
            label: '结果',
            value: (
              <StatusTag
                status={testResult.status}
                tone={testResult.status === 'succeeded' ? 'success' : 'danger'}
                label={testResult.status === 'succeeded' ? '成功' : testResult.status === 'pending' ? '未完成' : '失败'}
              />
            ),
          },
          { label: '耗时', value: `${testResult.durationMs}ms` },
          { label: 'HTTP', value: String(testResult.request?.path ?? '') },
          { label: '错误', value: testResult.error || testResult.message || '—' },
          {
            label: '产出',
            value: `${testResult.result?.images ?? 0} 图 / ${testResult.result?.videos ?? 0} 视频 / ${testResult.result?.text ? '有文本' : '无文本'}`,
          },
        ]}
      />
      {testResult.responsePreview && (
        <pre className="mt-3 max-h-[200px] overflow-auto rounded-lg bg-muted p-3 font-mono text-[12px] text-muted-foreground">
          {testResult.responsePreview}
        </pre>
      )}
    </Panel>
  );
}
