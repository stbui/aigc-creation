import { useEffect, useRef, useState } from 'react';
import { Panel } from './components';
import { drawPreview, renderBadgeCanvas } from './utils';
import type { AigcLabelSpec } from '../../../types/api';

/**
 * 示例底图 + 实时合成预览。
 *
 * 渲染失败只影响预览，不阻断保存：配色或字体不合法时用户仍能修改并重试。
 */
export function PreviewPanel({ spec }: { spec: AigcLabelSpec }) {
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 样式变了就重画预览
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    try {
      drawPreview(canvas, spec, renderBadgeCanvas(spec));
      setPreviewError(null);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : '预览渲染失败');
    }
  }, [spec]);

  return (
    <Panel title="预览" note="按合成规则实时计算">
      <canvas ref={previewRef} width={760} height={500} className="block h-auto w-full rounded-xl" />
      {previewError && <p className="mt-2 text-xs text-danger-text">{previewError}</p>}
      <p className="mt-2.5 text-xs leading-5 text-muted-foreground">
        预览只影响你看到的画面；用户拿到的图片由服务端按同一组参数合成。
      </p>
    </Panel>
  );
}
