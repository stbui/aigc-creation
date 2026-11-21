import type { CSSProperties } from 'react';
import { Download } from 'lucide-react';
import { StateLoading } from './StateViews';
import { ResultMedia } from './ResultMedia';
import type { ToolResult } from './toolShellTypes';

/**
 * ToolShell 右栏的产品系结果卡片。
 *
 * 仅供 `ToolShell` 内部按 `resultView: 'product-card'` 渲染，不从组件目录对外
 * 暴露 —— 页面需要自定义结果栏时用 `resultPane` / `sourcePane` 注入。
 */

/** 结果卡骨架：铺满结果栏 + 按图片比例收敛的居中大图卡 */
const RESULT_MAIN = 'grid w-full min-w-0 min-h-0 flex-1 border-0 rounded-none bg-transparent max-[900px]:min-h-[360px]';

const RESULT_STATE = 'flex w-full min-h-0 items-center justify-center';

const RESULT_CARD =
  'relative box-border w-[min(100%,680px)] max-w-full h-auto max-h-[calc(100%-48px)] min-h-0 m-0 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--page-bg)] aspect-[var(--result-card-aspect)]';

const RESULT_CARD_NARROW = 'max-[900px]:w-full max-[900px]:max-h-none';

/**
 * 产品系单图工具（商品换色）的生成中卡片。
 *
 * 参考站不是一块铺满右栏的白板，而是在原图比例的位置显示一张浅灰占位卡。
 * 保持这个形状，生成完成时结果卡不会跳变尺寸。
 */
export function ProductCardGenerating({ aspect }: { aspect?: number }) {
  const ratio = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75;
  return (
    <main className={`product-retouch-result product-recolor-result ${RESULT_MAIN}`}>
      <div
        className={`${RESULT_STATE} max-[900px]:py-6`}
        style={{ '--result-card-aspect': ratio } as CSSProperties}
      >
        <div
          className={`flex items-center justify-center overflow-hidden bg-[var(--color-border-soft)] ${RESULT_CARD} ${RESULT_CARD_NARROW} [&_.state-loading]:box-border [&_.state-loading]:size-full [&_.state-loading]:min-h-0 [&_.state-loading]:p-6 [&_.state-loading]:text-xs [&_.state-loading]:leading-[22px] [&_.state-loading]:text-[color:var(--text-desc)] [&_.state-loading-tip]:text-xs [&_.state-loading-tip]:leading-[22px] [&_.state-loading-tip]:text-[color:var(--text-desc)] [&_.state-spinner]:size-8 [&_.state-spinner]:border-[var(--tool-border-6)] [&_.state-spinner]:border-t-[var(--tool-border-brand-3)]`}
        >
          <StateLoading tip="正在生成换色结果…" />
        </div>
      </div>
    </main>
  );
}

/** 商品换色结果卡：与参考站一致，只保留图片、角标和下载入口。 */
export function ProductCardResult({
  result,
  title,
  badge,
  fallbackAspect,
  onPreview,
}: {
  result: ToolResult;
  title: string;
  badge: string;
  fallbackAspect?: number;
  onPreview: () => void;
}) {
  const measured = result.width && result.height ? result.width / result.height : undefined;
  const ratio = measured || fallbackAspect || 1.5;
  return (
    <main className={`product-retouch-result product-recolor-result ${RESULT_MAIN}`}>
      <div
        className={RESULT_STATE}
        style={{ '--result-card-aspect': ratio } as CSSProperties}
      >
        <figure className={`product-retouch-result-card ${RESULT_CARD} ${RESULT_CARD_NARROW}`}>
          <button
            type="button"
            className="block size-full cursor-zoom-in border-0 bg-transparent p-0"
            aria-label={`预览${title}结果`}
            onClick={onPreview}
          >
            <ResultMedia
              url={result.url!}
              modality={result.modality}
              alt={`${title}结果`}
              className="block size-full object-contain object-center"
            />
            <span className="absolute top-3 left-3 w-max rounded-[var(--radius-card)] bg-[rgba(38,42,52,0.72)] px-[9px] py-1 text-xs leading-[17.5px] text-card">
              {badge}
            </span>
          </button>
          <a
            className="absolute top-4 right-4 z-3 inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-control)] border-0 bg-brand px-3 text-xs leading-none whitespace-nowrap text-card shadow-[0_4px_10px_rgba(85,70,216,0.2)] hover:bg-[var(--surface-brand-1)]"
            href={result.url}
            download
            target="_blank"
            rel="noreferrer"
          >
            <Download size={14} />
            下载
          </a>
        </figure>
      </div>
    </main>
  );
}
