import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Trash2,
  X,
} from 'lucide-react';
import {
  ActionButton,
  Button,
  StatusTag,
  formatDateTime,
} from '~/admin-ui/primitives';
import { useBodyScrollLock } from '~/hooks';
import { BACKEND_LABEL, type AssetRow } from './constants';
import { assetLabel, fmtBytes, fmtFormat, thumbOf } from './utils';
import type { AssetStatus } from '../../../types/api';

/**
 * 素材预览：左侧看图，右侧看提示词与信息。
 *
 * 原来的灯箱把图片铺满全屏、提示词塞在浮动面板里，运营复核「图是否合格」时
 * 需要在图上反复开合面板。改为固定两栏后，图片与它的生成依据（提示词 /
 * 模型 / 比例 / 画质 / 素材属性）始终并排，翻页时右侧整块随当前素材更新。
 *
 * 图片与视频共用同一套外壳：视频走原生播放器，除媒体节点外翻页、信息与
 * 业务动作完全一致，避免视频素材被当成「另一种东西」对待。
 *
 * 下架 / 删除仍保留在这里：看图时最常发现违规素材，退回列表再操作会丢失
 * 当前浏览位置。删除仍需二次确认（由页面统一弹条）。
 */
export function AssetPreview({
  assets,
  index,
  statusBusyId,
  canHide,
  canDelete,
  onIndexChange,
  onClose,
  onToggleStatus,
  onDelete,
}: {
  assets: AssetRow[];
  index: number;
  statusBusyId: string | null;
  canHide: boolean;
  canDelete: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onToggleStatus: (row: AssetRow, next: AssetStatus) => void;
  onDelete: (row: AssetRow) => void;
}) {
  const asset = assets[index];
  const [promptCopied, setPromptCopied] = useState(false);

  useBodyScrollLock(true);

  // 换图时复位复制状态，否则会显示「已复制」但剪贴板里还是上一张的提示词
  useEffect(() => {
    setPromptCopied(false);
  }, [asset?.id]);

  // Esc 关闭；←/→ 翻页。挂在 window 上，焦点在任意按钮里都能生效
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (assets.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      onIndexChange((index + direction + assets.length) % assets.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assets.length, index, onClose, onIndexChange]);

  if (!asset) return null;

  const generation = asset.generation;
  const isVideo = asset.format.startsWith('video/');
  const mediaUrl = thumbOf(asset.sourceUrl);
  const go = (direction: -1 | 1) => {
    onIndexChange((index + direction + assets.length) % assets.length);
  };

  const copyPrompt = async () => {
    if (!generation?.prompt) return;
    try {
      await navigator.clipboard.writeText(generation.prompt);
      setPromptCopied(true);
    } catch {
      setPromptCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[900] flex"
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
      data-testid="admin-asset-preview"
    >
      {/* 左：媒体舞台。点击黑色背景关闭，图片/视频本身不关闭 */}
      <div
        className="relative flex min-w-0 flex-1 items-center justify-center bg-[rgba(10,12,20,0.96)] p-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {isVideo ? (
          <video
            key={asset.id}
            data-viewer-video="1"
            className="max-h-full max-w-full rounded-md bg-black"
            src={mediaUrl}
            aria-label={`${assetLabel(asset)}视频预览`}
            controls
            autoPlay
            muted
            playsInline
            preload="metadata"
          >
            您的浏览器不支持视频播放
          </video>
        ) : (
          <img
            key={asset.id}
            className="max-h-full max-w-full object-contain"
            src={mediaUrl}
            alt={`${assetLabel(asset)}素材预览`}
          />
        )}

        {assets.length > 1 && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute top-1/2 left-4 -translate-y-1/2 bg-white/15 text-white hover:bg-white/25"
              aria-label="上一个素材"
              title="上一个素材（←）"
              onClick={() => go(-1)}
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute top-1/2 right-4 -translate-y-1/2 bg-white/15 text-white hover:bg-white/25"
              aria-label="下一个素材"
              title="下一个素材（→）"
              onClick={() => go(1)}
            >
              <ChevronRight className="size-5" />
            </Button>
          </>
        )}

        <span className="absolute bottom-4 left-4 rounded-full bg-black/50 px-2.5 py-0.5 text-[12px] leading-5 text-white/80 tabular-nums">
          {index + 1} / {assets.length}
        </span>
      </div>

      {/* 右：提示词 + 素材信息 + 业务动作。栏内独立滚动，长提示词不会顶掉动作区 */}
      <aside
        className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card text-foreground"
        aria-label="素材详情"
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-base leading-6 font-semibold" title={assetLabel(asset)}>
                {assetLabel(asset)}
              </h2>
              <StatusTag
                status={asset.status}
                label={asset.status === 'visible' ? '已上架' : '已下架'}
                tone={asset.status === 'visible' ? 'success' : 'warn'}
              />
            </div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              {asset.kind === 'original' ? '原始上传' : '生成图'} · {formatDateTime(asset.createdAt)}
            </p>
          </div>
          <ActionButton variant="ghost" size="sm" ariaLabel="关闭预览" onClick={onClose}>
            <X className="size-4" />
          </ActionButton>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {generation && (
            <section aria-labelledby="asset-generation-heading">
              <h3 id="asset-generation-heading" className="mb-2 text-sm font-medium text-foreground">
                生成信息
              </h3>
              <InfoList
                items={[
                  { label: '模型', value: generation.modelName },
                  { label: '画面比例', value: generation.ratio ?? '—' },
                  { label: '画质', value: generation.quality ?? '—' },
                  {
                    label: '任务 ID',
                    value: (
                      <code className="font-mono text-[12px] break-all text-muted-foreground">
                        {generation.taskId}
                      </code>
                    ),
                  },
                ]}
              />
            </section>
          )}

          <section aria-labelledby="asset-meta-heading">
            <h3 id="asset-meta-heading" className="mb-2 text-sm font-medium text-foreground">
              素材信息
            </h3>
            <InfoList
              items={[
                {
                  label: '尺寸',
                  value: asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—',
                },
                { label: '格式', value: fmtFormat(asset.format) },
                { label: '大小', value: fmtBytes(asset.sizeBytes) },
                {
                  label: '存储',
                  value: BACKEND_LABEL[asset.storageBackend] ?? asset.storageBackend,
                },
                { label: '所属用户', value: asset.ownerEmail },
                { label: '项目', value: asset.projectName },
              ]}
            />
          </section>

          <section aria-labelledby="asset-prompt-heading">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 id="asset-prompt-heading" className="text-sm font-medium text-foreground">
                提示词
              </h3>
              {generation?.prompt && (
                <ActionButton
                  variant="ghost"
                  size="xs"
                  icon={promptCopied ? Check : Copy}
                  onClick={() => void copyPrompt()}
                >
                  {promptCopied ? '已复制' : '复制'}
                </ActionButton>
              )}
            </div>
            {generation?.prompt ? (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-[12px] leading-5 whitespace-pre-wrap break-words text-foreground">
                {generation.prompt}
              </p>
            ) : (
              <p className="text-[12px] leading-5 text-muted-foreground">
                原始上传素材没有生成提示词。
              </p>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button asChild variant="outline" size="sm">
            <a href={mediaUrl} download target="_blank" rel="noreferrer">
              <Download className="size-4" />
              {isVideo ? '下载原视频' : '下载原图'}
            </a>
          </Button>
          {canHide && (
            <ActionButton
              variant="outline"
              size="sm"
              icon={asset.status === 'visible' ? EyeOff : Eye}
              disabled={statusBusyId === asset.id}
              onClick={() => {
                onClose();
                onToggleStatus(asset, asset.status === 'visible' ? 'hidden' : 'visible');
              }}
            >
              {asset.status === 'visible' ? '下架' : '恢复'}
            </ActionButton>
          )}
          {canDelete && (
            <ActionButton variant="destructive" size="sm" icon={Trash2} onClick={() => onDelete(asset)}>
              删除
            </ActionButton>
          )}
        </footer>
      </aside>
    </div>
  );
}

/**
 * 标签与值同一行的信息表。
 *
 * 通用 `Descriptions` 把标签压在值上方（每条占两行），信息一多右侧栏会被
 * 拉得很长；这里按「固定标签列 + 自适应值列」排，长值（邮箱、提示词来源）
 * 自行换行，标签不跟着漂。字号保持全站 12px 下限。
 */
function InfoList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-3 text-[12px] leading-5">
          <dt className="w-16 shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
