import { useEffect, useState } from 'react';
import { computeExpandPlacement, loadImageSize } from '../lib/expandGeometry';

/**
 * 智能扩图的「原图 + 目标画布」几何预览。
 *
 * 参考站在上传后即用 .smart-expand-source-preview 显示目标画幅，并把原图按
 * 当前占比和九宫格位置绝对定位（宽高各占 64% 内的等比区域）。这里只做
 * 版式预览，不生成像素；真实扩图仍必须由模型完成。
 *
 * 画布用 aspect-ratio 表达目标比例，原图用归一化 placement 转成百分比定位，
 * 因此与提交给后端的 placementX/Y/Width/Height 是同一份几何数据。
 */
export function ExpandLayoutPreview({
  sourceUrl,
  ratio,
  occupy,
  position,
}: {
  sourceUrl: string;
  ratio: string;
  occupy: number;
  position: string;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSize(null);
    setFailed(false);
    if (!sourceUrl) return () => { cancelled = true; };
    void loadImageSize(sourceUrl)
      .then((next) => {
        if (!cancelled) setSize(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  const canvasRatio =
    ratio === 'original' && size
      ? `${size.width} / ${size.height}`
      : /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio)
        ? ratio.replace(':', ' / ')
        : '1 / 1';
  const placement = size
    ? computeExpandPlacement(size.width, size.height, ratio, occupy, position)
    : null;

  return (
    <figure
      className="smart-expand-source-preview"
      style={{ aspectRatio: canvasRatio }}
      aria-label="原图在目标画布中的布局预览"
    >
      {placement && sourceUrl && (
        <img
          src={sourceUrl}
          alt="待扩图原图"
          data-expand-preview="true"
          style={{
            width: `${placement.placementWidth * 100}%`,
            height: `${placement.placementHeight * 100}%`,
            left: `${placement.placementX * 100}%`,
            top: `${placement.placementY * 100}%`,
          }}
        />
      )}
      {failed && <figcaption className="smart-expand-preview-error">无法读取原图尺寸</figcaption>}
    </figure>
  );
}
