import './product-result.css';
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

/**
 * 产品系单图工具（商品换色）的生成中卡片。
 *
 * 参考站不是一块铺满右栏的白板，而是在原图比例的位置显示一张浅灰占位卡。
 * 保持这个形状，生成完成时结果卡不会跳变尺寸。
 */
export function ProductCardGenerating({ aspect }: { aspect?: number }) {
  const ratio = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75;
  return (
    <main className="product-retouch-result product-recolor-result">
      <div
        className="product-retouch-result-state"
        style={{ '--result-card-aspect': ratio } as CSSProperties}
      >
        <div className="free-generating-card product-recolor-generating-card">
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
    <main className="product-retouch-result product-recolor-result">
      <div
        className="product-retouch-result-state"
        style={{ '--result-card-aspect': ratio } as CSSProperties}
      >
        <figure className="product-retouch-result-card">
          <button
            type="button"
            className="product-retouch-result-preview"
            aria-label={`预览${title}结果`}
            onClick={onPreview}
          >
            <ResultMedia url={result.url!} modality={result.modality} alt={`${title}结果`} />
            <span className="product-retouch-result-mode">{badge}</span>
          </button>
          <a
            className="product-retouch-download"
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
