import type { ReactNode } from 'react';
import { ImagePlus, Layers, Sparkles } from 'lucide-react';

import { EMPTY_HINT, EMPTY_TITLE } from './constants';
import { ToolGeneratingState, type ToolResult } from './components';
import {
  AspectRatio,
  Badge,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  ToggleGroup,
  ToggleGroupItem,
} from './components';
import { assetThumbUrl } from './api';
import { fusionFailureText, type FusionResultStatus } from './utils';

/**
 * 舞台外框：宽度按所选比例自适应（页面 CSS 的 `multi-image-fusion-stage-frame`），
 * 内层是 shadcn `AspectRatio` 撑高的棋盘格舞台。
 */
function FusionStage({ ratio, children }: { ratio: number; children: ReactNode }) {
  return (
    <div className="multi-image-fusion-stage-frame">
      <AspectRatio ratio={ratio} className="multi-image-fusion-stage">
        {children}
      </AspectRatio>
    </div>
  );
}

/**
 * 结果面板的舞台区 —— 按状态渲染五种画面：
 * 生成中 / 失败（提交失败、生成失败、超时） / 空态 / 成功预览 + 缩略图。
 *
 * 状态判定与提交按钮由 `MultiFusionResultPanel` 持有，本组件只负责把
 * `status.state` 映射成对应的画面，不参与任何取数或动作判定。
 *
 * 2026-11-21 舞台、空态与失败态改由 shadcn 组合：比例框 `AspectRatio`、
 * 空态 `Empty`（三卡片斜叠插画作为 `EmptyMedia`）、尺寸胶囊 `Badge`、
 * 变体切换 `ToggleGroup`（单选，`aria-pressed` 由 Radix 维护）。
 * 棋盘格底是本页标志性视觉，作为舞台底色保留在页面 CSS（无交互语义的图形）。
 */
export function MultiFusionResultStage({
  status,
  submitting,
  results,
  activeResult,
  activeResultIndex,
  lastFailure,
  requestedCount,
  ratioWidth,
  ratioHeight,
  onSelectResult,
}: {
  status: FusionResultStatus;
  submitting: boolean;
  results: ToolResult[];
  activeResult: ToolResult | null;
  activeResultIndex: number;
  lastFailure: ToolResult | null;
  /** 本次提交实际请求的变体数，不随生成后的参数选择变化 */
  requestedCount: number;
  ratioWidth: number;
  ratioHeight: number;
  onSelectResult: (index: number) => void;
}) {
  const ratio = ratioWidth / ratioHeight;
  const failureHeading =
    status.state === 'timeout'
      ? '结果暂未返回'
      : status.state === 'submit_failed'
        ? '未能提交'
        : '生成失败';
  const failureDetail =
    status.state === 'timeout'
      ? '任务已提交，后台可能仍在生成。请稍后重新查询，或到「我的作品」查看。'
      : status.state === 'submit_failed'
        ? `未能创建生成任务。${lastFailure ? fusionFailureText(lastFailure.errorCode) : '请稍后重试'}`
        : fusionFailureText(lastFailure?.errorCode);

  if (submitting && results.length === 0 && !lastFailure) {
    return (
      <FusionStage ratio={ratio}>
        <div className="grid size-full place-items-center p-5.5">
          <ToolGeneratingState tip={`正在生成 ${Math.max(1, requestedCount)} 张融合变体…`} />
        </div>
      </FusionStage>
    );
  }

  if (lastFailure && results.length === 0) {
    return (
      <FusionStage ratio={ratio}>
        <Empty className="size-full border-0 p-5.5">
          <EmptyHeader>
            <EmptyTitle className="text-xs font-semibold text-foreground">
              {failureHeading}
            </EmptyTitle>
            <EmptyDescription className="text-xs leading-4.25">
              {failureDetail}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </FusionStage>
    );
  }

  if (results.length === 0) {
    return (
      <FusionStage ratio={ratio}>
        <Empty className="size-full border-0 p-5.5">
          {/* D-84: 参考站是 96x78 三卡片斜叠插画 (-9deg / 0 / +9deg), 非共用插画组件 */}
          <EmptyMedia className="mb-2 h-[78px] w-24 bg-transparent">
            <span className="relative block size-full" aria-hidden>
              <span className="absolute top-3 left-0.75 grid size-12.5 -rotate-9 place-items-center rounded-lg border border-border bg-card text-brand shadow-card">
                <ImagePlus className="size-4.5" />
              </span>
              <span className="absolute top-0 left-8 z-1 grid size-11.5 place-items-center rounded-lg border border-border bg-brand-bg text-brand">
                <Sparkles className="size-4" />
              </span>
              <span className="absolute top-4 right-0.25 grid size-12.5 rotate-9 place-items-center rounded-lg border border-border bg-card text-brand shadow-card">
                <Layers className="size-4.5" />
              </span>
            </span>
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle className="text-xs font-semibold text-foreground">
              {EMPTY_TITLE}
            </EmptyTitle>
            <EmptyDescription className="text-xs">{EMPTY_HINT}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </FusionStage>
    );
  }

  if (!activeResult?.url) {
    return (
      <FusionStage ratio={ratio}>
        <Empty className="size-full border-0 p-5.5">
          <EmptyHeader>
            <EmptyTitle className="text-xs font-semibold text-foreground">
              生成失败
            </EmptyTitle>
            <EmptyDescription className="text-xs">
              模型没有返回可用图片，请重试
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </FusionStage>
    );
  }

  const previewRatio =
    activeResult.width && activeResult.height ? activeResult.width / activeResult.height : ratio;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* D-86: 参考站成功态是棋盘格预览舞台 + 缩略图网格, 不是本地详情卡 */}
      <div className="multi-image-fusion-stage-frame">
        <AspectRatio ratio={previewRatio} className="multi-image-fusion-stage">
          <img
            src={activeResult.url}
            alt={`多图融合结果 ${activeResultIndex + 1}`}
            className="size-full cursor-zoom-in object-contain"
          />
          {activeResult.width && activeResult.height && (
            <Badge className="absolute right-3 bottom-3 h-6.25 gap-1 rounded-full bg-foreground/55 px-2 text-xs font-normal backdrop-blur-sm">
              {activeResult.width}×{activeResult.height}
            </Badge>
          )}
        </AspectRatio>
      </div>

      <ToggleGroup
        type="single"
        value={String(activeResultIndex)}
        onValueChange={(next) => {
          if (next !== '') onSelectResult(Number(next));
        }}
        aria-label="融合变体"
        spacing={2.25}
        className="mt-3 grid grid-cols-4 justify-center"
      >
        {results.map((item, index) => (
          <ToggleGroupItem
            key={item.url ?? index}
            value={String(index)}
            aria-label={`查看第 ${index + 1} 个融合变体`}
            className="relative size-18.5 min-w-0 overflow-hidden rounded-[10px] border-2 border-transparent bg-muted p-0 hover:-translate-y-0.25 data-[state=on]:border-brand/70"
          >
            <img
              src={assetThumbUrl(item.url, 240) ?? item.url}
              alt={`融合结果缩略图 ${index + 1}`}
              loading="lazy"
              decoding="async"
              className="size-full object-contain"
            />
            <Badge className="absolute right-1 bottom-1 size-4.25 justify-center rounded-md bg-foreground/65 p-0 text-xs font-normal">
              {index + 1}
            </Badge>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
