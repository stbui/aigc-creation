import { useState } from 'react';

/**
 * 原图 / 结果图分割对比。
 *
 * 局部重绘与去水印的结果区共用：结果图作为底层完整显示，原图用
 * clip-path 叠在左半区，拖拽全屏 range 即可改变分割位置。这里只负责
 * 展示，不发起任何生成请求；两张图的尺寸不同时统一 contain，避免对比
 * 过程中出现拉伸或裁切误导用户。
 */
export function ImageCompare({
  beforeUrl,
  afterUrl,
  beforeLabel = '原图',
  afterLabel = '结果图',
  className,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}) {
  const [position, setPosition] = useState(50);

  return (
    <figure className={`image-compare-frame${className ? ` ${className}` : ''}`}>
      <img className="image-compare-after" src={afterUrl} alt={afterLabel} draggable={false} />
      <div
        className="image-compare-before"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img src={beforeUrl} alt={beforeLabel} draggable={false} />
      </div>
      <span className="image-compare-before-label">{beforeLabel}</span>
      <span className="image-compare-after-label">{afterLabel}</span>
      <i className="image-compare-line" style={{ left: `${position}%` }} aria-hidden="true" />
      <input
        className="image-compare-range"
        type="range"
        min={0}
        max={100}
        value={position}
        aria-label="调整原图与结果图的对比位置"
        onChange={(event) => setPosition(Number(event.target.value))}
      />
    </figure>
  );
}
