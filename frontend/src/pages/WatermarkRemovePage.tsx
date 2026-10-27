import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { Columns2, Hand, Minus, Plus, Redo2, Square, Trash2, Undo2, X } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { useProject } from '../hooks/useProject';
import { useCreditCost } from '../hooks/useCreditLabel';
import { assetsApi } from '../lib/api';
import { ToolShell, type ToolAsset } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import {
  WatermarkMaskEditor,
  type WatermarkMaskHandle,
  type WatermarkMaskRegion,
  type WatermarkMaskTool,
} from '../components/WatermarkMaskEditor';
import { ToolHistoryPane } from '../components/ToolHistoryPane';

/**
 * 去除水印 —— 对齐参考站 watermark-remove 的上传态交互。
 *
 * 仅有抓手 / 对比（未出结果时禁用）/ 框选；默认框选。
 * 可见标注是 DOM（.mask-layer > .mask-mark），提交时才生成透明遮罩 PNG。
 */
export function WatermarkRemovePage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'remove_watermark', successMessage: '处理结果已生成' });
  const creditCost = useCreditCost('remove_watermark');
  const painter = useRef<WatermarkMaskHandle | null>(null);
  const maskBlobRef = useRef<Blob | null>(null);
  const maskAssetIdRef = useRef<string | null>(null);
  const maskSourceIdRef = useRef<string | null>(null);
  const lastSourceIdRef = useRef<string | null>(null);

  const [tool, setTool] = useState<WatermarkMaskTool>('rect');
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [painted, setPainted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [regions, setRegions] = useState<WatermarkMaskRegion[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [sourceImage, setSourceImage] = useState<ToolAsset | null>(null);
  /** 结果对比需要本次实际提交的源图，不能拿换图后的新图与旧结果拼在一起。 */
  const [sourceUrl, setSourceUrl] = useState('');

  const resetMaskSession = useCallback(() => {
    maskBlobRef.current = null;
    maskAssetIdRef.current = null;
    maskSourceIdRef.current = null;
    setPainted(false);
    setCanUndo(false);
    setCanRedo(false);
    setRegions([]);
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setTool('rect');
  }, []);

  const handleImagesChange = useCallback(
    (images: ToolAsset[]) => {
      const next = images[0] ?? null;
      setSourceImage(next);
      if (lastSourceIdRef.current === (next?.id ?? null)) return;
      lastSourceIdRef.current = next?.id ?? null;
      resetMaskSession();
      setSourceUrl('');
      setResult(null);
    },
    [resetMaskSession, setResult],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) painter.current?.redo();
        else painter.current?.undo();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        setZoom((value) => Math.min(140, value + 10));
        return;
      }
      if (event.key === '-') {
        setZoom((value) => Math.max(70, value - 10));
        return;
      }
      if (event.key.toLowerCase() === 'h') setTool('hand');
      if (event.key.toLowerCase() === 'r') setTool('rect');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleMaskState = useCallback(
    (hasPaint: boolean, undoable: boolean, redoable: boolean, nextRegions: WatermarkMaskRegion[]) => {
      setPainted(hasPaint);
      setCanUndo(undoable);
      setCanRedo(redoable);
      setRegions(nextRegions);
    },
    [],
  );

  const submit = async (inputs: ToolAsset[], settings: { ratio: string; resolution: string }) => {
    setSourceUrl(inputs[0]?.url ?? '');
    let maskAssetId: string | undefined;
    try {
      setPreparing(true);
      const sourceId = inputs[0]?.id ?? null;
      if (maskSourceIdRef.current !== sourceId) {
        maskBlobRef.current = null;
        maskAssetIdRef.current = null;
        maskSourceIdRef.current = sourceId;
      }
      const freshBlob = await painter.current?.toBlob();
      const blob = freshBlob ?? maskBlobRef.current;
      if (!blob) {
        message.warning('请先在图片上框出水印区域');
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
    } catch (error) {
      message.error((error as Error).message || '遮罩上传失败，请重试');
      return;
    } finally {
      setPreparing(false);
    }

    await run(inputs, {
      mode: 'manual',
      detectionMode: 'MANUAL',
      ...(maskAssetId ? { maskAssetId } : {}),
      outputFormat: 'PNG',
      ratio: settings.ratio,
      size: settings.resolution,
    });
  };

  const startReannotation = () => {
    painter.current?.clear();
    resetMaskSession();
    setResult(null);
  };

  const handleHistoryReuse = () => {
    painter.current?.clear();
    resetMaskSession();
    setSourceUrl('');
    setResult(null);
  };

  const previewStyle = (region: WatermarkMaskRegion) => ({
    position: 'absolute' as const,
    left: `${50 - (region.x / Math.max(region.width, 1)) * 100}%`,
    top: `${50 - (region.y / Math.max(region.height, 1)) * 100}%`,
    width: `${(region.sourceWidth / Math.max(region.width, 1)) * 100}%`,
    height: `${(region.sourceHeight / Math.max(region.height, 1)) * 100}%`,
    maxWidth: 'none',
    objectFit: 'fill' as const,
  });

  const toolButton = (value: WatermarkMaskTool, label: string, shortcut?: string, Icon = value === 'hand' ? Hand : Square) => (
    <span className="toolbar-item-wrap" key={value}>
      <button
        type="button"
        className={`redraw-tool-btn${tool === value ? ' active' : ''}`}
        aria-pressed={tool === value}
        title={shortcut ? `${label} (${shortcut})` : label}
        onClick={() => setTool(value)}
      >
        <Icon size={13} />
        {label}
      </button>
    </span>
  );

  return (
    <ToolShell
      capability="remove_watermark"
      pageClass="watermark-removal-page local-redraw-page"
      title="去除水印"
      desc="框选、圈选或涂抹水印区域，即可去除图片中的水印"
      upload={{
        title: '上传图片',
        required: true,
        max: 1,
        hint: '点击、拖拽或粘贴图片上传，最多 1 张',
        promptIcon: <Plus size={22} />,
      }}
      replaceUpload
      onImagesChange={handleImagesChange}
      renderUploadPreview={(uploads, controls) => {
        const image = uploads[0];
        if (!image) return null;
        return (
          <div className={`source-row${controls.uploading ? ' processing' : ''}`}>
            <button
              type="button"
              className="local-source-preview"
              aria-label="预览待去水印图片"
              onClick={() => controls.preview(image)}
            >
              <img src={image.url} alt="待去水印图片" draggable={false} />
            </button>
            <div>
              <button
                type="button"
                disabled={controls.uploading}
                onClick={() => controls.remove(image.id)}
              >
                重新编辑
              </button>
              <button
                type="button"
                className="soft"
                disabled={controls.uploading}
                onClick={controls.open}
              >
                重新上传
              </button>
            </div>
          </div>
        );
      }}
      submitLabel="开始去除"
      creditLabel={creditCost === 0 ? '限时免费' : undefined}
      emptyDesc="上传图片并标注水印区域后，处理结果将在此处展示"
      formValid={painted && !preparing}
      submitting={submitting}
      keepSourceWhileSubmitting
      result={result}
      resultTag="手动遮罩"
      resultCompare={
        result?.status === 'succeeded' && result.url && sourceUrl
          ? { beforeUrl: sourceUrl, beforeLabel: '原图', afterLabel: '去水印后' }
          : undefined
      }
      onSubmit={submit}
      onHistoryReuse={handleHistoryReuse}
      resultActions={
        result ? (
          <button type="button" className="tool-result-action" onClick={startReannotation}>
            重新标注
          </button>
        ) : null
      }
      trailingPane={
        <ToolHistoryPane capability="remove_watermark" refreshKey={result?.url} emptyText="暂无去水印记录" />
      }
      children={(images) => {
        if (images.length === 0) return null;
        return (
          <ToolCard
            title={<><i className="pk-required-mark">*</i>水印标记</>}
            className="prompt-card watermark-mark-card"
          >
            {(regions.length > 0 ? regions : [null]).map((region, index) => (
              <div
                key={region?.id ?? 'pending'}
                className={`redraw-prompt watermark-annotation-row${region ? ' is-marked' : ' is-pending'}`}
              >
                <label className={`redraw-prompt-label ${region ? 'is-marked' : 'is-pending'}`}>
                  <i />
                  标注{index + 1}
                </label>
                {region && sourceImage ? (
                  <div className="annotation-mark-preview">
                    <img src={sourceImage.url} alt={`标注${index + 1}框选区域`} style={previewStyle(region)} />
                    <button
                      type="button"
                      className="annotation-remove"
                      aria-label={`删除标注${index + 1}`}
                      title={`删除标注${index + 1}`}
                      onClick={() => painter.current?.remove(region.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </ToolCard>
        );
      }}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) {
          return (
            <div className="redraw-intro" aria-label="去除水印介绍">
              <video
                className="redraw-intro-video"
                src="/static/mp4/03_qcsy.mp4"
                autoPlay
                loop
                muted
                playsInline
                aria-label="去除水印演示"
              />
              <div className="redraw-intro-copy">
                <strong>去除水印</strong>
                <p>框选、圈选或涂抹水印区域，即可去除图片中的水印</p>
              </div>
            </div>
          );
        }

        return (
          <main className="local-redraw-stage" aria-busy={submitting}>
            <div className="redraw-stage-topbar">
              <div className="redraw-toolbar" role="toolbar" aria-label="重绘工具">
                {toolButton('hand', '抓手', 'H')}
                <span className="toolbar-item-wrap">
                  <button type="button" className="redraw-tool-btn" title="对比" disabled aria-pressed={false}>
                    <Columns2 size={13} />
                    对比
                  </button>
                  <b className="toolbar-divider" />
                  <button
                    type="button"
                    className={`redraw-tool-btn${tool === 'rect' ? ' active' : ''}`}
                    aria-pressed={tool === 'rect'}
                    title="框选 (R)"
                    onClick={() => setTool('rect')}
                  >
                    <Square size={13} />
                    框选
                  </button>
                </span>
              </div>
              <div className="stage-actions stage-actions-placeholder" aria-hidden="true" />
            </div>

            <WatermarkMaskEditor
              url={image.url}
              alt="待去水印的原图"
              tool={tool}
              zoom={zoom}
              pan={pan}
              onPanChange={setPan}
              onState={handleMaskState}
              handleRef={painter}
            />

            <div className="canvas-footer-toolbar redraw-canvas-footer">
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canUndo}
                title="撤回 (Ctrl+Z)"
                onClick={() => painter.current?.undo()}
              >
                <Undo2 size={16} />
                撤回
              </button>
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canRedo}
                title="恢复 (Ctrl+Shift+Z)"
                onClick={() => painter.current?.redo()}
              >
                <Redo2 size={16} />
                恢复
              </button>
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!painted}
                onClick={() => painter.current?.clear()}
              >
                <Trash2 size={16} />
                清空
              </button>
              <b className="redraw-tool-divider" />
              <button
                type="button"
                className="redraw-footer-btn redraw-zoom-btn"
                aria-label="缩小"
                title="缩小 (-)"
                onClick={() => setZoom((value) => Math.max(70, value - 10))}
              >
                <Minus size={16} />
              </button>
              <span className="redraw-zoom-value">{zoom}%</span>
              <button
                type="button"
                className="redraw-footer-btn redraw-zoom-btn"
                aria-label="放大"
                title="放大 (+)"
                onClick={() => setZoom((value) => Math.min(140, value + 10))}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="shortcut-hint redraw-shortcut-hint">
              快捷键：H 抓手 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
            </div>
          </main>
        );
      }}
    />
  );
}
