import { useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { Circle, Eraser, Hand, Minus, Paintbrush, Plus, Redo2, RotateCcw, Square, Undo2 } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { useProject } from '../hooks/useProject';
import { assetsApi } from '../lib/api';
import { ToolShell, type ToolAsset } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import { MaskCanvas, type MaskCanvasHandle, type MaskTool } from '../components/MaskCanvas';
import { ToolHistoryPane } from '../components/ToolHistoryPane';

/**
 * 去除水印 —— 1:1 还原参考站 https://ijihua.cn/watermark-remove 的标注画布。
 *
 * 参考站实际交互（从 index-Do3-_JpH.js 的 createWatermarkRemoval 提取）：
 *   抓手 / 画笔 / 橡皮 / 框选 / 圈选 → 合成 PNG 遮罩 → 上传素材 →
 *   createWatermarkRemoval({ maskAssetId, detectionMode:'MANUAL' })。
 * 本地后端已接入同一遮罩协议：透明像素 = 去除区域。
 *
 * 自动/指定区域保留为快捷兜底（本地真实镜像修补）。手动模式要求至少
 * 涂出 4 个采样像素可识别的区域，按钮才允许提交。
 */

type Mode = 'manual' | 'auto' | 'region';

const TOOLS: Array<{ value: MaskTool; label: string; shortcut: string; icon: typeof Hand }> = [
  { value: 'hand', label: '抓手', shortcut: 'H', icon: Hand },
  { value: 'brush', label: '画笔', shortcut: 'B', icon: Paintbrush },
  { value: 'eraser', label: '擦除', shortcut: 'E', icon: Eraser },
  { value: 'rect', label: '框选', shortcut: 'R', icon: Square },
  { value: 'ellipse', label: '圈选', shortcut: 'O', icon: Circle },
];

const REGIONS = [
  { value: 'bottom_right', label: '右下角' },
  { value: 'bottom_left', label: '左下角' },
  { value: 'top_right', label: '右上角' },
  { value: 'top_left', label: '左上角' },
  { value: 'center', label: '画面中央' },
];

export function WatermarkRemovePage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'remove_watermark', successMessage: '处理结果已生成' });
  const painter = useRef<MaskCanvasHandle | null>(null);
  const maskBlobRef = useRef<Blob | null>(null);
  const maskAssetIdRef = useRef<string | null>(null);
  const maskSourceIdRef = useRef<string | null>(null);

  const [mode, setMode] = useState<Mode>('manual');
  const [region, setRegion] = useState('bottom_right');
  const [tool, setTool] = useState<MaskTool>('brush');
  const [brush, setBrush] = useState(30);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [painted, setPainted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [preparing, setPreparing] = useState(false);
  /** 结果对比需要本次实际提交的源图，不能在用户换图后拿新图与旧结果拼在一起。 */
  const [sourceUrl, setSourceUrl] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) painter.current?.redo();
        else painter.current?.undo();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(160, z + 10));
        return;
      }
      if (e.key === '-') {
        setZoom((z) => Math.max(60, z - 10));
        return;
      }
      const match = TOOLS.find((item) => item.shortcut.toLowerCase() === e.key.toLowerCase());
      if (match) setTool(match.value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (inputs: ToolAsset[], settings: { ratio: string; resolution: string }) => {
    setSourceUrl(inputs[0]?.url ?? '');
    let maskAssetId: string | undefined;
    if (mode === 'manual') {
      try {
        setPreparing(true);
        const sourceId = inputs[0]?.id ?? null;
        if (maskSourceIdRef.current !== sourceId) {
          maskBlobRef.current = null;
          maskAssetIdRef.current = null;
          maskSourceIdRef.current = sourceId;
        }
        // 结果态会卸载画布；「重新生成」必须复用上一次的遮罩，而不是误报未标注。
        const freshBlob = await painter.current?.toBlob();
        const blob = freshBlob ?? maskBlobRef.current;
        if (!blob) {
          message.warning('请先在图片上圈出水印区域');
          return;
        }
        if (freshBlob) {
          maskBlobRef.current = freshBlob;
          maskAssetIdRef.current = null;
        }
        if (!maskAssetIdRef.current) {
          const projectId = await ensureProject();
          const asset = await assetsApi.upload(
            new File([blob], `watermark-mask-${Date.now()}.png`, { type: 'image/png' }),
            projectId,
          );
          maskAssetIdRef.current = asset.id;
        }
        maskAssetId = maskAssetIdRef.current;
      } catch (e) {
        message.error((e as Error).message || '遮罩上传失败，请重试');
        return;
      } finally {
        setPreparing(false);
      }
    }

    await run(inputs, {
      mode: mode === 'region' ? 'region' : 'auto',
      region,
      detectionMode: mode === 'manual' ? 'MANUAL' : 'AUTO',
      ...(maskAssetId ? { maskAssetId } : {}),
      ...(mode === 'manual' ? { outputFormat: 'PNG' } : {}),
      ratio: settings.ratio,
      size: settings.resolution,
    });
  };

  const resultTag =
    mode === 'manual' ? '手动遮罩' : mode === 'auto' ? '自动识别' : REGIONS.find((item) => item.value === region)?.label;

  /*
   * 结果态会卸载标注画布，遮罩的矢量笔迹无法随组件一起恢复。这里明确清空
   * 缓存再回到标注态，避免用户看到一张空白画布、提交时却悄悄复用旧遮罩。
   */
  const startReannotation = () => {
    maskBlobRef.current = null;
    maskAssetIdRef.current = null;
    maskSourceIdRef.current = null;
    setPainted(false);
    setCanUndo(false);
    setCanRedo(false);
    setResult(null);
  };

  return (
    <ToolShell
      capability="remove_watermark"
      title="去除水印"
      desc="框选、圈选或涂抹水印区域，即可去除图片中的水印"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      submitLabel="开始去除"
      hint="* 请仅处理你拥有版权或已获授权的图片。"
      emptyDesc="上传图片并标注水印区域后，处理结果将在此处展示"
      formValid={(mode !== 'manual' || painted) && !preparing}
      submitting={submitting}
      result={result}
      resultTag={resultTag}
      resultCompare={
        result?.status === 'succeeded' && result.url && sourceUrl
          ? { beforeUrl: sourceUrl, beforeLabel: '原图', afterLabel: '去水印后' }
          : undefined
      }
      onSubmit={submit}
      resultActions={
        result?.status === 'succeeded' ? (
          <button type="button" className="tool-result-action" onClick={startReannotation}>
            重新标注
          </button>
        ) : null
      }
      trailingPane={
        <ToolHistoryPane capability="remove_watermark" refreshKey={result?.url} emptyText="暂无去水印记录" />
      }
      sourcePane={(images) => {
        const image = images[0];
        if (!image || mode !== 'manual') return null;

        const toolButton = (item: (typeof TOOLS)[number]) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              className={`redraw-tool-btn${tool === item.value ? ' active' : ''}`}
              aria-pressed={tool === item.value}
              title={`${item.label} (${item.shortcut})`}
              onClick={() => setTool(item.value)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        };

        return (
          <div className="pk-source-pane redraw-stage">
            <div className="redraw-stage-topbar">
              <div className="redraw-toolbar" role="toolbar" aria-label="水印标注工具">
                {toolButton(TOOLS[0])}
                {toolButton(TOOLS[1])}
                {toolButton(TOOLS[2])}
                <span className="redraw-tool-divider" />
                {toolButton(TOOLS[3])}
                {toolButton(TOOLS[4])}
                {(tool === 'brush' || tool === 'eraser') && (
                  <label className="redraw-toolbar-brush">
                    <span className="sr-only">画笔大小</span>
                    <input
                      aria-label="画笔大小"
                      type="range"
                      min={10}
                      max={60}
                      step={2}
                      value={brush}
                      onChange={(e) => setBrush(Number(e.target.value))}
                    />
                    <output>{brush}</output>
                  </label>
                )}
              </div>
            </div>

            <div className="redraw-canvas-wrap">
              <MaskCanvas
                url={image.url}
                alt="待去水印的原图"
                tool={tool}
                brush={brush}
                zoom={zoom}
                pan={pan}
                onPanChange={setPan}
                onState={(hasPaint, undoable, redoable) => {
                  setPainted(hasPaint);
                  setCanUndo(undoable);
                  setCanRedo(redoable);
                }}
                handleRef={painter}
              />
            </div>

            <p className="redraw-mask-hint">
              {painted ? '透明区域将被修补，其余像素保持不变。' : '还没标注。涂抹、框选或圈选水印区域后再提交。'}
            </p>
            <div className="redraw-canvas-footer">
              <button type="button" className="redraw-footer-btn" disabled={!canUndo} title="撤回 (Ctrl+Z)" onClick={() => painter.current?.undo()}>
                <Undo2 size={13} />撤回
              </button>
              <button type="button" className="redraw-footer-btn" disabled={!canRedo} title="恢复 (Ctrl+Shift+Z)" onClick={() => painter.current?.redo()}>
                <Redo2 size={13} />恢复
              </button>
              <button type="button" className="redraw-footer-btn" onClick={() => painter.current?.clear()}>
                <RotateCcw size={13} />清空
              </button>
              <span className="redraw-tool-divider" />
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="缩小" title="缩小 (-)" onClick={() => setZoom((z) => Math.max(60, z - 10))}>
                <Minus size={16} />
              </button>
              <span className="redraw-zoom-value">{zoom}%</span>
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="放大" title="放大 (+)" onClick={() => setZoom((z) => Math.min(160, z + 10))}>
                <Plus size={16} />
              </button>
            </div>
            <p className="redraw-shortcut-hint">
              快捷键：H 抓手 · B 画笔 · E 擦除 · R 框选 · O 圈选 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
            </p>
          </div>
        );
      }}
    >
      <ToolCard title="处理方式">
        <div className="tool-select-row">
          {[
            { value: 'manual', label: '手动标注' },
            { value: 'auto', label: '自动识别' },
            { value: 'region', label: '指定区域' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={mode === item.value}
              className={`tool-region-chip${mode === item.value ? ' active' : ''}`}
              onClick={() => setMode(item.value as Mode)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === 'region' && (
          <label className="tool-select-field">
            <span>区域位置</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        )}
        <p className="tool-card-copy">
          {mode === 'manual'
            ? '推荐使用手动标注：只有圈出的透明区域会被修补，压在主体上的水印也能精确避开。'
            : '自动/区域模式使用本地镜像修补，适合角落纯色或渐变背景上的水印。'}
        </p>
        <p className="tool-card-copy">本地算法无法恢复水印下方消失的商品细节；这类图片建议配置云端重绘通道。</p>
      </ToolCard>
    </ToolShell>
  );
}
