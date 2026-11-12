import { ImageOff, Loader2, RefreshCw } from 'lucide-react';

import { runtimeOf, taskErrorText } from './utils';
import type { CapabilityDef, Task } from '../../types/api';

/**
 * 无产出任务的占位卡：生成中 / 生成失败。
 *
 * 失败任务若还有能力定义，就在原地给「重试」——沿用原任务的输入与参数新建一次
 * 生成，不必回到工具页重填。
 */
export interface WorkCardPlaceholderProps {
  task: Task;
  capability?: CapabilityDef;
  retrying: boolean;
  onRetry: () => void;
}

export function WorkCardPlaceholder({
  task,
  capability,
  retrying,
  onRetry,
}: WorkCardPlaceholderProps) {
  if (task.status !== 'failed') {
    return (
      <span className="my-work-image-placeholder">
        <Loader2 size={18} className="my-work-generating-spinner" />
        <strong>生成中</strong>
        <small>完成后会自动出现在这里</small>
      </span>
    );
  }

  const runtime = capability ? runtimeOf(capability) : null;
  const retryTitle = runtime
    ? runtime.effective === 'unavailable'
      ? runtime.reason || '该能力暂无可用模型通道'
      : runtime.effective === 'disabled'
        ? runtime.reason || '该能力已下线'
        : '沿用原参数重新生成'
    : '沿用原参数重新生成';

  return (
    <span className="my-work-image-placeholder">
      <ImageOff size={18} />
      <strong>生成失败</strong>
      <small>{taskErrorText(task.errorCode)}</small>
      {capability && (
        <button
          type="button"
          className="my-work-placeholder-retry"
          disabled={retrying}
          title={retryTitle}
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          {retrying ? (
            <Loader2 size={12} className="my-work-generating-spinner" />
          ) : (
            <RefreshCw size={12} />
          )}
          {retrying ? '重试中…' : '重试'}
        </button>
      )}
    </span>
  );
}
