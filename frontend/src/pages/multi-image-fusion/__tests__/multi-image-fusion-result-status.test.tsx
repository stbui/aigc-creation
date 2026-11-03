import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolResult } from '../components';
import { MultiFusionResultPanel } from '../MultiFusionResultPanel';

function result(index: number): ToolResult {
  return {
    status: 'succeeded',
    url: `https://example.test/fusion-${index}.png`,
    provider: 'gateway',
  };
}

function renderPanel({
  submitting = false,
  results = [],
  lastFailure = null,
  requestedCount = 4,
}: {
  submitting?: boolean;
  results?: ToolResult[];
  lastFailure?: ToolResult | null;
  requestedCount?: number;
}) {
  return render(
    <MultiFusionResultPanel
      submitting={submitting}
      results={results}
      activeResult={results[0] ?? null}
      activeResultIndex={0}
      lastFailure={lastFailure}
      requestedCount={requestedCount}
      ratio="1:1"
      ratioWidth={1}
      ratioHeight={1}
      canRegenerate
      onRegenerate={() => {}}
      onDownload={() => {}}
      onSelectResult={() => {}}
    />,
  );
}

describe('MultiFusionResultPanel 结果状态', () => {
  it('请求 4 张只返回 1 张时标记部分成功并说明缺失数量', () => {
    renderPanel({ results: [result(1)] });

    expect(screen.getByText('部分成功')).toBeInTheDocument();
    expect(screen.getByText('已生成 1 / 4 张，其余 3 张未返回 · 1:1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载当前图' })).toBeEnabled();
  });

  it('请求数量全部返回时标记完整成功', () => {
    renderPanel({ results: Array.from({ length: 4 }, (_, index) => result(index + 1)) });

    expect(screen.getByText('完整成功')).toBeInTheDocument();
    expect(screen.getByText('已生成 4 / 4 张 · 1:1')).toBeInTheDocument();
  });

  it('生成中明确显示本次请求张数', () => {
    renderPanel({ submitting: true });

    expect(screen.getByText('生成中')).toBeInTheDocument();
    expect(screen.getByText('正在生成 4 张融合变体 · 1:1')).toBeInTheDocument();
    expect(screen.getByText('正在生成 4 张融合变体…')).toBeInTheDocument();
  });

  it('失败态显示可读文案而不是内部错误码', () => {
    renderPanel({ lastFailure: { status: 'failed', errorCode: 'EMPTY_OUTPUT' } });

    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('模型没有返回可用图片，请重试')).toBeInTheDocument();
    expect(screen.queryByText('EMPTY_OUTPUT')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载当前图' })).toBeDisabled();
  });
});
