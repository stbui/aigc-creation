import { RefreshCw, Trash2 } from 'lucide-react';

import type { Task } from '../../types/api';
import { Button, ResultMedia, StateEmpty, StateSkeleton, Surface, SurfaceContent, SurfaceHeader, SurfaceTitle, formatDuration } from './components';
import { useApp } from './hooks';

interface ToolResultCardProps {
  name: string;
  generating: boolean;
  resultUrl: string | undefined;
  task: Task | null;
  onRegenerate: () => void;
  onClear: () => void;
}

/** 右栏：生成中的骨架、结果介质、宽高 / 时长与重新生成。 */
export function ToolResultCard({
  name,
  generating,
  resultUrl,
  task,
  onRegenerate,
  onClear,
}: ToolResultCardProps) {
  const { message } = useApp();

  return (
    <Surface>
      <SurfaceHeader>
        <SurfaceTitle>生成结果</SurfaceTitle>
      </SurfaceHeader>
      <SurfaceContent>
      {generating && !resultUrl ? (
        /* 生成中 → 骨架占位 (与工具页结果栏同构), 不退回空态。
           骨架块最小高度 220px，避免出图瞬间卡片高度跳变。 */
        <div className="flex flex-col gap-3 [&_.state-skeleton.is-block]:min-h-[220px]">
          <StateSkeleton variant="block" count={1} />
          <p className="m-0 text-center text-xs leading-5 text-muted-foreground">正在生成，请稍候…</p>
        </div>
      ) : resultUrl ? (
        <>
          {/* 视频产出必须用 <video> —— 浏览器会把 mp4 当图片解码, 表现为空白预览 */}
          <ResultMedia
            className="block w-full rounded-md bg-muted"
            url={resultUrl}
            modality={task?.outputAsset?.modality}
            aigc={task?.outputAsset?.aigc}
            alt={name}
          />
          <div className="mt-2.5 flex items-center justify-between text-xs">
            <div>
              <span className="text-muted-foreground">
                {task?.outputAsset?.width}×{task?.outputAsset?.height} · {task?.outputAsset?.format}
                {/* 视频没有宽高 (Jimp 不解视频), 补一个时长 */}
                {formatDuration(task?.outputAsset?.durationMs)
                  ? ` · ${formatDuration(task?.outputAsset?.durationMs)}`
                  : ''}
              </span>
            </div>
            <div className="tool-result-actions">
              <Button disabled={generating} size="sm" onClick={onRegenerate} >
                {generating && <span className="state-spinner is-small" aria-hidden />}
                重新生成
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onClear();
                  message.info('已清空当前结果，素材仍保留在素材库');
                }}
              >
                {<Trash2 size={13} />}
                清空
              </Button>
            </div>
          </div>
        </>
      ) : (
        <StateEmpty
          compact
          title="还没有生成结果"
          desc="上传素材并点击生成后，结果会显示在这里。"
        />
      )}
      </SurfaceContent>
    </Surface>
  );
}
