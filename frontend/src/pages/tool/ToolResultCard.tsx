import { RefreshCw, Trash2 } from 'lucide-react';

import type { Task } from '../../types/api';
import { Button, Card, ResultMedia, StateEmpty, StateSkeleton, Typography, formatDuration } from './components';
import { useApp } from './hooks';

const { Text } = Typography;

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
    <Card className="tool-result-card" title="生成结果">
      {generating && !resultUrl ? (
        /* 生成中 → 骨架占位 (与工具页结果栏同构), 不退回空态 */
        <div className="tool-result-loading">
          <StateSkeleton variant="block" count={1} />
          <p className="tool-result-loading-tip">正在生成，请稍候…</p>
        </div>
      ) : resultUrl ? (
        <>
          {/* 视频产出必须用 <video> —— 浏览器会把 mp4 当图片解码, 表现为空白预览 */}
          <ResultMedia
            className="tool-result-img"
            url={resultUrl}
            modality={task?.outputAsset?.modality}
            aigc={task?.outputAsset?.aigc}
            alt={name}
          />
          <div className="tool-result-meta">
            <div>
              <Text type="secondary">
                {task?.outputAsset?.width}×{task?.outputAsset?.height} · {task?.outputAsset?.format}
                {/* 视频没有宽高 (Jimp 不解视频), 补一个时长 */}
                {formatDuration(task?.outputAsset?.durationMs)
                  ? ` · ${formatDuration(task?.outputAsset?.durationMs)}`
                  : ''}
              </Text>
            </div>
            <div className="tool-result-actions">
              <Button size="small" icon={<RefreshCw size={13} />} onClick={onRegenerate} loading={generating}>
                重新生成
              </Button>
              <Button
                size="small"
                icon={<Trash2 size={13} />}
                onClick={() => {
                  onClear();
                  message.info('已清空当前结果，素材仍保留在素材库');
                }}
              >
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
    </Card>
  );
}
