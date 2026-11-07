import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../components';
import { MultiFusionResultPanel } from '../MultiFusionResultPanel';
import type { FusionFailureKind } from '../utils';

function result(index: number): ToolResult {
  return {
    status: 'succeeded',
    url: `https://example.test/fusion-${index}.png`,
  };
}

function renderPanel({
  submitting = false,
  results = [],
  lastFailure = null,
  failureKind = null,
  requestedCount = 4,
  canRegenerate = true,
  onRetryPoll,
}: {
  submitting?: boolean;
  results?: ToolResult[];
  lastFailure?: ToolResult | null;
  failureKind?: FusionFailureKind | null;
  requestedCount?: number;
  canRegenerate?: boolean;
  onRetryPoll?: () => void;
}) {
  return render(
    <MultiFusionResultPanel
      submitting={submitting}
      results={results}
      activeResult={results[0] ?? null}
      activeResultIndex={0}
      lastFailure={lastFailure}
      failureKind={failureKind}
      requestedCount={requestedCount}
      ratio="1:1"
      ratioWidth={1}
      ratioHeight={1}
      canRegenerate={canRegenerate}
      onRetryPoll={onRetryPoll}
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
    renderPanel({
      lastFailure: { status: 'failed', errorCode: 'EMPTY_OUTPUT' },
      failureKind: 'generation',
    });

    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('模型没有返回可用图片，请重试')).toBeInTheDocument();
    expect(screen.queryByText('EMPTY_OUTPUT')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载当前图' })).toBeDisabled();
  });

  it('轮询超时显示等待结果，并允许按原任务重新查询而不是重复生成', () => {
    const onRetryPoll = vi.fn();
    renderPanel({
      lastFailure: { status: 'failed', errorCode: 'POLL_TIMEOUT' },
      failureKind: 'timeout',
      canRegenerate: false,
      onRetryPoll,
    });

    expect(screen.getByText('等待结果')).toBeInTheDocument();
    expect(screen.getByText('结果暂未返回')).toBeInTheDocument();
    expect(
      screen.getByText('任务已提交，后台可能仍在生成。请稍后重新查询，或到「我的作品」查看。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('失败')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新查询' }));
    expect(onRetryPoll).toHaveBeenCalledOnce();
  });

  it('任务建立前失败显示未提交，不与生成失败混淆', () => {
    renderPanel({
      lastFailure: { status: 'failed', errorCode: 'GENERATE_FAILED' },
      failureKind: 'submit',
      canRegenerate: false,
    });

    expect(screen.getByText('未提交')).toBeInTheDocument();
    expect(screen.getByText('未能提交')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled();
  });
});
