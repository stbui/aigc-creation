import { useEffect, useRef, useState } from 'react';
import { loadCanvasSource } from '../lib/mattingEditor';

/**
 * 一键抠图结果编辑器的画布载入。
 *
 * 2026-11-15 从 `MattingResultEditor` 抽出：该组件此前同时持有「图片载入 →
 * 画布初始化 → 底座备份」与手势、撤销栈、导出。载入是一段独立的异步生命周期
 * （取消标记 + objectURL 释放），抽出来后才好确认它不会泄漏或与新图竞争。
 *
 * 底座（`baseCanvasRef`）是「修补 / 重置」的回填来源，必须与结果画布同尺寸。
 */
interface Options {
  resultUrl: string;
  /**
   * 换图时重置编辑状态（工具、缩放、平移、撤销栈、手势）。
   *
   * 由调用方提供：这些状态属于编辑器而不是载入流程，hook 只负责在载入前
   * 通知一次，不在自己这里持有。
   */
  reset: () => void;
}

export function useMattingSource({ resultUrl, reset }: Options) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    let release: () => void = () => undefined;
    setLoading(true);
    setLoadError('');
    reset();

    void (async () => {
      try {
        const loaded = await loadCanvasSource(resultUrl);
        release = loaded.release;
        if (cancelled) return;
        const image = loaded.image;
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('结果图片尺寸无效');

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('结果画布尚未就绪');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d')?.drawImage(image, 0, 0);

        const base = document.createElement('canvas');
        base.width = image.naturalWidth;
        base.height = image.naturalHeight;
        base.getContext('2d')?.drawImage(image, 0, 0);
        baseCanvasRef.current = base;

        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '结果图片加载失败');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [reset, resultUrl]);

  return { canvasRef, baseCanvasRef, loading, loadError, naturalSize };
}
