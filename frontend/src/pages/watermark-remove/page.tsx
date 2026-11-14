import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { ZOOM_DEFAULT, ZOOM_STEP } from './constants';
import {
  ToolHistoryPane,
  ToolShell,
  type ToolAsset,
  type WatermarkMaskHandle,
  type WatermarkMaskRegion,
  type WatermarkMaskTool,
} from './components';
import { useApp, useCreditCost, useProject, useToolTask } from './hooks';
import { assetsApi } from './api';
import { clampZoom } from './utils';
import { WatermarkRemoveAnnotationPanel } from './WatermarkRemoveAnnotationPanel';
import { WatermarkRemoveIntro } from './WatermarkRemoveIntro';
import { WatermarkRemoveStage } from './WatermarkRemoveStage';
import { WatermarkRemoveUploadPreview } from './WatermarkRemoveUploadPreview';

/**
 * 去除水印 —— 对齐参考站 watermark-remove 的上传态交互。
 *
 * 仅有抓手 / 对比（未出结果时禁用）/ 框选；默认框选。
 * 可见标注是 DOM（.mask-layer > .mask-mark），提交时才生成透明遮罩 PNG。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：画布舞台 `WatermarkRemoveStage`
 * （工具栏 `WatermarkRemoveToolbar` / 底部操作条 `WatermarkRemoveCanvasFooter`）、
 * 水印标记面板 `WatermarkRemoveAnnotationPanel`（逐条 `WatermarkRemoveAnnotationRow`）、
 * 上传预览 `WatermarkRemoveUploadPreview` 与空态 `WatermarkRemoveIntro`；
 * 遮罩 / 提交 / 删除等写操作仍留在本文件。
 */

export function WatermarkRemovePage() {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'remove_watermark', successMessage: '处理结果已生成' });
  const creditCost = useCreditCost('remove_watermark');
  const painter = useRef<WatermarkMaskHandle | null>(null);
  const maskBlobRef = useRef<Blob | null>(null);
  const maskAssetIdRef = useRef<string | null>(null);
  const maskSourceIdRef = useRef<string | null>(null);
  const lastSourceIdRef = useRef<string | null>(null);

  const [tool, setTool] = useState<WatermarkMaskTool>('rect');
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
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
    setZoom(ZOOM_DEFAULT);
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
        setZoom((value) => clampZoom(value, ZOOM_STEP));
        return;
      }
      if (event.key === '-') {
        setZoom((value) => clampZoom(value, -ZOOM_STEP));
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

    /*
     * 不提交 mode：能力定义只声明 auto / region，误传 manual 会被
     * validateCapabilityParams 在扣费前判 40001。专用页的「手动标注」语义
     * 已由 detectionMode=MANUAL + maskAssetId 表达，不需要第三个枚举值。
     */
    await run(inputs, {
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

  const zoomIn = () => setZoom((value) => clampZoom(value, ZOOM_STEP));
  const zoomOut = () => setZoom((value) => clampZoom(value, -ZOOM_STEP));

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
      requiredInputs={['mask']}
      replaceUpload
      onImagesChange={handleImagesChange}
      renderUploadPreview={(uploads, controls) => {
        const image = uploads[0];
        if (!image) return null;
        return (
          <WatermarkRemoveUploadPreview
            image={image}
            uploading={controls.uploading}
            onPreview={() => controls.preview(image)}
            onRemove={() => controls.remove(image.id)}
            onOpen={controls.open}
          />
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
          <WatermarkRemoveAnnotationPanel
            regions={regions}
            sourceImage={sourceImage}
            onRemove={(id) => painter.current?.remove(id)}
          />
        );
      }}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) return <WatermarkRemoveIntro />;
        return (
          <WatermarkRemoveStage
            image={image}
            tool={tool}
            zoom={zoom}
            pan={pan}
            submitting={submitting}
            painted={painted}
            canUndo={canUndo}
            canRedo={canRedo}
            painter={painter}
            onToolChange={setTool}
            onPanChange={setPan}
            onState={handleMaskState}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
        );
      }}
    />
  );
}
