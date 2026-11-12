import { StateError } from './components';

/** 「没连上」不是「没素材」：加载失败只渲染失败态，不落空态分支 */
export function LibraryErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <StateError
      title="素材加载失败"
      desc="没能取回素材列表。可能是后端未启动或网络异常，重试一次即可。"
      detail={detail}
      onRetry={onRetry}
    />
  );
}
