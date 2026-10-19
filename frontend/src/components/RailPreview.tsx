import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 侧栏 hover 预览 —— 复刻参考站 workspace-menu-guide-popover。
 *
 * 为什么用 portal: 侧栏自身需要 overflow 滚动 (15 个能力放不下), 而预览要溢出到主区,
 * 放在侧栏 DOM 内会被 overflow 裁掉。参考站是把预览绝对定位到侧栏右侧并允许溢出,
 * 这里用 portal + 视口内自动翻转, 等效且不会与滚动容器打架。
 */
export function RailPreview({
  anchor,
  title,
  imageUrl,
  fallbackText,
}: {
  anchor: HTMLElement;
  title: string;
  imageUrl: string | null;
  fallbackText: string;
}) {
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    const update = () => {
      const r = anchor.getBoundingClientRect();
      const previewWidth = 296;
      const gap = 12;
      // 右侧空间不足时翻到左侧
      const flip = r.right + gap + previewWidth > window.innerWidth - 8;
      setRect({
        top: Math.min(Math.max(r.top + r.height / 2, 90), window.innerHeight - 40),
        left: flip ? Math.max(8, r.left - gap - previewWidth) : r.right + gap,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  if (!rect) return null;

  const showImage = Boolean(imageUrl) && !imgFailed;

  return createPortal(
    <div className="rail-preview" style={{ top: rect.top, left: rect.left }} role="tooltip">
      <span className="rail-preview-title">{title}</span>
      {showImage ? (
        <img
          className="rail-preview-img"
          src={imageUrl as string}
          alt={`${title}示例`}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="rail-preview-desc">{fallbackText}</span>
      )}
    </div>,
    document.body,
  );
}

/** 内容区卡片缩略图: 加载失败时回退到设计化空态, 不留破图 */
export function SafeThumb({
  src,
  alt,
  fallback,
}: {
  src: string;
  alt: string;
  fallback: ReactNode;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
