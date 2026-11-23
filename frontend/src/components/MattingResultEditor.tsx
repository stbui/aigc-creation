import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Spinner, useApp } from '../ui';
import {
  appendPaintPoint,
  backdropOf,
  clamp,
  paintCanvas,
  ratioValue,
  renderMattingExport,
  ZOOM_MAX,
  ZOOM_MIN,
  type EditorTool,
  type PaintAction,
  type PaintGesture,
  type PanGesture,
  type ZoomTarget,
} from '../lib/mattingEditor';
import { MattingResultToolbar } from './MattingResultToolbar';
import { MattingResultFooter } from './MattingResultFooter';
import { MattingResultOverlay } from './MattingResultOverlay';
import { useMattingSource } from './useMattingSource';

/**
 * 一键抠图结果编辑器 —— 对齐参考站 background-remove 的结果态。
 *
 * 抠图模型只负责产出透明主体；结果区的以下动作都在浏览器本地完成，不能
 * 伪装成一次新的 AI 调用：
 *   - 抓手平移、主体/画布双缩放、滚轮与 +/- 缩放
 *   - 原图/结果图分割对比
 *   - 擦除（destination-out）与修补（从原始抠图结果回填）
 *   - 撤回/恢复/重置（重放矢量笔迹，避免 4K ImageData 快照占内存）
 *   - 按当前比例与背景色合成并下载 PNG
 *
 * 编辑器只改像素，不改变服务端任务记录；刷新或重新生成会回到原始抠图结果。
 */

export function MattingResultEditor({
  resultUrl,
  originalUrl,
  selectedColor,
  customColor,
  customAlpha,
  outputRatio,
}: {
  resultUrl: string;
  originalUrl: string;
  selectedColor: string;
  customColor: string;
  customAlpha: number;
  outputRatio: string;
}) {
  const { message } = useApp();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<PaintAction[]>([]);
  const redoRef = useRef<PaintAction[]>([]);
  const paintGestureRef = useRef<PaintGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<EditorTool>('hand');
  const [compare, setCompare] = useState(false);
  const [compareSplit, setCompareSplit] = useState(50);
  const [brushSize, setBrushSize] = useState(30);
  const [subjectZoom, setSubjectZoom] = useState(100);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget>('subject');
  const [subjectPan, setSubjectPan] = useState({ x: 0, y: 0 });
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [, setRevision] = useState(0);

  const bump = useCallback(() => setRevision((value) => value + 1), []);

  /**
   * 换图时把编辑现场归零：工具、对比、缩放、平移、撤销栈与未完成手势。
   * 载入流程（`useMattingSource`）在拉图前调用一次，避免旧位移与新画幅错位。
   */
  const resetEditorState = useCallback(() => {
    setCursor(null);
    setCompare(false);
    setCompareSplit(50);
    setTool('hand');
    setSubjectZoom(100);
    setCanvasZoom(100);
    setSubjectPan({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
    actionsRef.current = [];
    redoRef.current = [];
    paintGestureRef.current = null;
    panGestureRef.current = null;
    bump();
  }, [bump]);

  const { canvasRef, baseCanvasRef, loading, loadError, naturalSize } = useMattingSource({
    resultUrl,
    reset: resetEditorState,
  });
  const backdrop = useMemo(
    () => backdropOf(selectedColor, customColor, customAlpha),
    [selectedColor, customColor, customAlpha],
  );
  const previewRatio = useMemo(() => {
    const natural = naturalSize.width && naturalSize.height ? naturalSize.width / naturalSize.height : 1;
    return ratioValue(outputRatio, natural);
  }, [naturalSize, outputRatio]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseCanvasRef.current;
    if (!canvas || !base) return;
    paintCanvas(canvas, base, actionsRef.current);
  }, []);



  // 比例变化时重置视图，避免旧平移量让新画幅跑出可视区 (参考站同行为)。
  useEffect(() => {
    setSubjectPan({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
    setSubjectZoom(100);
    setCanvasZoom(100);
    setCompareSplit(50);
  }, [outputRatio]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const frameSize = useMemo(() => {
    if (!stageSize.width || !stageSize.height || !naturalSize.width) return { width: 0, height: 0 };
    const maxWidth = Math.max(120, Math.min(680, stageSize.width - 80));
    const maxHeight = Math.max(120, Math.min(520, stageSize.height - 150));
    let width = Math.min(maxWidth, maxHeight * previewRatio);
    let height = width / Math.max(previewRatio, 0.01);
    if (height > maxHeight) {
      height = maxHeight;
      width = height * previewRatio;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }, [naturalSize.width, previewRatio, stageSize]);

  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp(((clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
      y: clamp(((clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height),
      cssX: clamp(clientX - rect.left, 0, rect.width),
      cssY: clamp(clientY - rect.top, 0, rect.height),
      scale: rect.width / canvas.width,
    };
  }, []);


  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, output')) return;
    if (tool !== 'hand' && !compare) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const target: ZoomTarget = zoomTarget === 'subject' && !compare ? 'subject' : 'canvas';
    const origin = target === 'subject' ? subjectPan : canvasPan;
    panGestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: origin.x,
      originY: origin.y,
      target,
    };
  };

  const movePan = (e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const next = {
      x: gesture.originX + e.clientX - gesture.startX,
      y: gesture.originY + e.clientY - gesture.startY,
    };
    if (gesture.target === 'subject') setSubjectPan(next);
    else setCanvasPan(next);
  };

  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panGestureRef.current?.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    panGestureRef.current = null;
  };

  const updateCursor = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'hand' || compare) {
      setCursor(null);
      return;
    }
    const point = pointFromClient(e.clientX, e.clientY);
    setCursor(point ? { x: point.cssX, y: point.cssY } : null);
  };

  const startPaint = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tool === 'hand' || compare) return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const action: PaintAction = {
      tool,
      points: [{ x: point.x, y: point.y }],
      radius: Math.max(1, brushSize / 2 / Math.max(point.scale, 0.0001)),
    };
    actionsRef.current = [...actionsRef.current, action];
    redoRef.current = [];
    paintGestureRef.current = { pointerId: e.pointerId, action };
    setCursor({ x: point.cssX, y: point.cssY });
    redraw();
    bump();
  };

  const movePaint = (e: ReactPointerEvent<HTMLDivElement>) => {
    updateCursor(e);
    const gesture = paintGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    appendPaintPoint(gesture.action, { x: point.x, y: point.y });
    redraw();
    bump();
  };

  const endPaint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = paintGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    paintGestureRef.current = null;
  };

  const undo = useCallback(() => {
    const action = actionsRef.current[actionsRef.current.length - 1];
    if (!action) return;
    actionsRef.current = actionsRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, action];
    redraw();
    bump();
  }, [bump, redraw]);

  const redo = useCallback(() => {
    const action = redoRef.current[redoRef.current.length - 1];
    if (!action) return;
    redoRef.current = redoRef.current.slice(0, -1);
    actionsRef.current = [...actionsRef.current, action];
    redraw();
    bump();
  }, [bump, redraw]);

  const reset = useCallback(() => {
    actionsRef.current = [];
    redoRef.current = [];
    paintGestureRef.current = null;
    panGestureRef.current = null;
    setSubjectPan({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
    setSubjectZoom(100);
    setCanvasZoom(100);
    redraw();
    bump();
  }, [bump, redraw]);

  const changeZoom = useCallback(
    (delta: number) => {
      if (zoomTarget === 'canvas') {
        setCanvasZoom((value) => clamp(value + delta, ZOOM_MIN, ZOOM_MAX));
      } else {
        setSubjectZoom((value) => clamp(value + delta, ZOOM_MIN, ZOOM_MAX));
      }
    },
    [zoomTarget],
  );

  // 滚轮必须用非 passive 的原生监听，React 的 onWheel 在部分浏览器不能 preventDefault。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      changeZoom(event.deltaY < 0 ? 10 : -10);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [changeZoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'h') setTool('hand');
      if (key === 'e') {
        setTool('eraser');
        setCompare(false);
      }
      if (key === 'r') {
        setTool('repair');
        setCompare(false);
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        changeZoom(10);
      }
      if (key === '-') {
        event.preventDefault();
        changeZoom(-10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeZoom, redo, undo]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas || downloading) return;
    setDownloading(true);
    try {
      redraw();
      const out = renderMattingExport(canvas, { outputRatio, backdrop, subjectZoom, subjectPan, stageSize });
      out.toBlob((blob) => {
        if (!blob) {
          setDownloading(false);
          message.error('图片导出失败，请稍后重试');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `一键抠图-${Date.now()}.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        setDownloading(false);
      }, 'image/png');
    } catch {
      setDownloading(false);
      message.error('结果图跨域受限，无法导出编辑后的图片；请直接下载原始抠图结果');
    }
  };

  const selectTool = (next: EditorTool) => {
    setTool(next);
    if (next === 'hand') setCompare(false);
  };

  const canUndo = actionsRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const activeZoom = zoomTarget === 'canvas' ? canvasZoom : subjectZoom;
  const previewBackground = backdrop ?? undefined;

  return (
    <div className="matting-result-editor" aria-label="一键抠图结果编辑">
      {!loading && !loadError && (
        <MattingResultToolbar
          tool={tool}
          compare={compare}
          brushSize={brushSize}
          downloading={downloading}
          onSelectTool={selectTool}
          onToggleCompare={() => setCompare((value) => !value)}
          onBrushSizeChange={setBrushSize}
          onDownload={download}
        />
      )}

      <div ref={stageRef} className="background-remove-stage has-result" aria-busy={loading}>
        {/* 画布必须常驻：加载 effect 的首轮就要拿 canvasRef 写入像素，不能用加载态把它卸载。 */}
        <div
          className={`background-remove-preview result-tool-${compare ? 'hand' : tool}${compare ? ' is-comparing' : ''}${loading || loadError ? ' is-state-hidden' : ''}`}
          style={{
            backgroundColor: previewBackground,
            transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom / 100})`,
          }}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
            <div
              className="background-result-content"
              style={{ transform: `translate(${subjectPan.x}px, ${subjectPan.y}px) scale(${subjectZoom / 100})` }}
            >
              <div
                ref={frameRef}
                className="background-result-image-frame"
                style={{
                  width: frameSize.width || undefined,
                  height: frameSize.height || undefined,
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
                onPointerDown={startPaint}
                onPointerMove={movePaint}
                onPointerUp={endPaint}
                onPointerCancel={endPaint}
                onPointerLeave={() => setCursor(null)}
              >
                <canvas
                  ref={canvasRef}
                  className="background-result-canvas"
                  aria-label="一键抠图结果"
                />

                <MattingResultOverlay
                  compare={compare}
                  compareSplit={compareSplit}
                  originalUrl={originalUrl}
                  cursor={cursor}
                  tool={tool}
                  brushSize={brushSize}
                  onCompareSplitChange={setCompareSplit}
                />
              </div>
            </div>
        </div>

        {loading && (
          <div className="matting-editor-loading" role="status">
            <Spinner />
            <span>正在载入抠图结果…</span>
          </div>
        )}
        {!loading && loadError && (
          <div className="matting-editor-loading" role="alert">
            <strong>结果载入失败</strong>
            <span>{loadError}</span>
            <a href={resultUrl} download target="_blank" rel="noreferrer">
              直接下载原始结果
            </a>
          </div>
        )}

        {!loading && !loadError && (
          <MattingResultFooter
            canUndo={canUndo}
            canRedo={canRedo}
            zoomTarget={zoomTarget}
            activeZoom={activeZoom}
            onUndo={undo}
            onRedo={redo}
            onReset={reset}
            onZoomTargetChange={setZoomTarget}
            onChangeZoom={changeZoom}
          />
        )}

        {!loading && !loadError && (
          <div className="background-result-shortcuts">
            快捷键：H 抓手 · E 擦除 · R 修补 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
          </div>
        )}
      </div>
    </div>
  );
}
