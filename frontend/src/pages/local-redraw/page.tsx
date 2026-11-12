import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MAX_ANNOTATIONS,
  TOOLS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  type AnnotationDraft,
  type MaskPainterHandle,
  type MaskState,
  type PaintTool,
  type RegionBounds,
} from './constants';
import { ToolShell, type ToolAsset } from './components';
import { useApp, useProject, useToolHistory, useToolTask } from './hooks';
import { assetsApi, assetSrc } from './api';
import { LocalRedrawAnnotationPanel } from './LocalRedrawAnnotationPanel';
import { LocalRedrawHistoryPane } from './LocalRedrawHistoryPane';
import { LocalRedrawIntro } from './LocalRedrawIntro';
import { LocalRedrawStage } from './LocalRedrawStage';
import { LocalRedrawUploadPreview } from './LocalRedrawUploadPreview';

/**
 * 局部重绘 —— 1:1 复刻参考站 https://ijihua.cn/local-redraw。
 *
 * ## 画布交互 (2026-10-25 重构)
 *
 * 工具: 抓手 (平移) / 画笔 (涂抹重绘区) / 橡皮 (擦除涂抹) / 框选 / 圈选。
 * 额外能力: 缩放 (按钮 ±) / 撤回 / 恢复 / 清空。
 *
 * 笔迹用**矢量标记**保存 (不是落成不可逆的位图)：
 *   - brush/eraser → 一串采样点
 *   - rect/ellipse → 归一化矩形
 * 渲染时重放整份标记列表 → 生成可见叠层与黑白遮罩。因此撤回/恢复/清空
 * 只是增删数组元素并重放，不需要保存 4K ImageData 快照。
 *
 * ## 遮罩怎么走 (仍沿用 2026-10-22 的协议)
 *
 * 所有标记合成一张 PNG：透明区 = 要重绘的区域 (OpenAI `images/edits` 约定)，
 * 上传成素材后随 `maskAssetId` 提交。后端对不支持遮罩的通道判 `42205` 退款。
 *
 * 诚实披露: local_redraw 必须由真实 inpainting 模型完成, 本地没有实现；
 * 没有可用通道时后端判 failed/42204 并退款，本页据 runtime 提前禁用提交。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：画布舞台 `LocalRedrawStage`
 * （工具栏 `LocalRedrawToolbar` / 底部操作条 `LocalRedrawCanvasFooter`）、
 * 标注面板 `LocalRedrawAnnotationPanel`（逐条 `LocalRedrawAnnotationItem`）、
 * 历史栏 `LocalRedrawHistoryPane`、上传预览 `LocalRedrawUploadPreview`、
 * 空态 `LocalRedrawIntro`；历史取数复用共享 `useToolHistory`（经 `hooks.ts` 转出），
 * 画布 / 提交 / 删除等写操作仍留在本文件。
 */
export function LocalRedrawPage() {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({
    capability: 'local_redraw',
    successMessage: '重绘结果已生成',
  });

  const [tool, setTool] = useState<PaintTool>('rect');
  const [brush, setBrush] = useState(30);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [painted, setPainted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  /** 当前有效的画布区域；id 稳定，描述/参考图都按 id 绑定。 */
  const [regions, setRegions] = useState<RegionBounds[]>([]);
  /** 每个区域各有一份描述与可选参考图；删除/重排其它区域不会串位。 */
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<number, AnnotationDraft>>({});
  /** 遮罩上传期间也要禁用按钮 —— 否则连点会传两份遮罩 */
  const [preparing, setPreparing] = useState(false);
  /**
   * 正在上传参考图的下标集合。
   *
   * 用集合而不是单个下标: 用户可能连着触发两条标注的上传，若只存一个值，
   * 先完成的请求会把状态提前清空，后一条还在上传时按钮又变成可提交。
   */
  const [referenceUploading, setReferenceUploading] = useState<Set<number>>(() => new Set());
  const uploadBusy = referenceUploading.size > 0;
  /** 历史抽屉（窄屏）；桌面右栏折叠由 `historyCollapsed` 控制 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  /** 原图真实宽高比；画布按它展示，避免非方图出现额外留白。 */
  const [sourceAspect, setSourceAspect] = useState(1);
  const painter = useRef<MaskPainterHandle | null>(null);
  /*
   * 提交后结果态会卸载标注画布，painter 也随之清空。「重新生成」必须复用
   * 上一次的遮罩快照，否则会误报「请先标注」；同一张源图且遮罩未改时也
   * 复用已上传的素材，避免每次重试都新传一份 PNG。
   */
  const maskBlobRef = useRef<Blob | null>(null);
  const maskAssetIdRef = useRef<string | null>(null);
  const maskSourceIdRef = useRef<string | null>(null);
  const lastSourceIdRef = useRef<string | null>(null);

  const {
    tasks: history,
    loading: historyLoading,
    error: historyError,
    retry: retryHistory,
  } = useToolHistory('local_redraw', result?.url);

  const updateAnnotationDraft = (id: number, patch: Partial<AnnotationDraft>) => {
    setAnnotationDrafts((prev) => {
      const current = prev[id] ?? { prompt: '', reference: null };
      return { ...prev, [id]: { ...current, ...patch } };
    });
  };

  const uploadReference = async (id: number, file: File | undefined) => {
    if (!file) return;
    try {
      setReferenceUploading((prev) => new Set(prev).add(id));
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      updateAnnotationDraft(id, {
        reference: { id: asset.id, url: assetSrc(asset) ?? '', name: file.name },
      });
    } catch (error) {
      message.error((error as Error).message || '参考图上传失败，请重试');
    } finally {
      setReferenceUploading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  /** 清掉当前图的遮罩、笔迹状态与结果；源图本身由上传位管理。 */
  const clearMaskSession = useCallback(() => {
    maskBlobRef.current = null;
    maskAssetIdRef.current = null;
    maskSourceIdRef.current = null;
    setPainted(false);
    setCanUndo(false);
    setCanRedo(false);
    setRegions([]);
    setAnnotationDrafts({});
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setResult(null);
  }, [setResult]);

  /** 上传位发生变化时同步源图，并清掉上一张图残留的遮罩与描述。 */
  const handleImagesChange = useCallback(
    (images: ToolAsset[]) => {
      const next = images[0] ?? null;
      const nextId = next?.id ?? null;
      if (lastSourceIdRef.current === nextId) return;
      lastSourceIdRef.current = nextId;
      setSourceAspect(1);
      clearMaskSession();
      setReferenceUploading(() => new Set());
    },
    [clearMaskSession],
  );

  /**
   * 结果态会卸载标注画布，因此失败后也必须给用户一个回到画布的入口；
   * 只保留「重新生成」会让一次失败变成无法调整标注的死路。
   */
  const handleReannotation = () => {
    clearMaskSession();
  };

  /**
   * 历史结果回填后清掉上一轮结果态、遮罩缓存与旧标注。
   *
   * ToolShell 会先把历史产出复制成当前项目的新素材；MaskPainter 因 URL
   * 变化自动重置笔迹。这里把页面级引用和描述一起清掉，避免把上一张图的
   * 区域描述与参考图带到新素材上。
   */
  const handleHistoryReuse = () => {
    clearMaskSession();
    setHistoryOpen(false);
  };

  const handlePaintState = useCallback((state: MaskState) => {
    setPainted(state.painted);
    setCanUndo(state.canUndo);
    setCanRedo(state.canRedo);
    setRegions(state.regions);
  }, []);

  const handleNaturalSize = useCallback(({ width, height }: { width: number; height: number }) => {
    if (width <= 0 || height <= 0) return;
    const next = width / height;
    setSourceAspect((current) => (Math.abs(current - next) < 0.0001 ? current : next));
  }, []);

  /** 画布拒绝新区域时的提示；引用必须稳定，否则 MaskPainter 的 memo 失效。 */
  const handleRegionLimit = useCallback(() => {
    message.warning(`最多支持 ${MAX_ANNOTATIONS} 个标注区域，请先撤回或删除一个`);
  }, [message]);

  const toggleHistory = useCallback(() => setHistoryCollapsed((value) => !value), []);
  const expandHistory = useCallback(() => setHistoryCollapsed(false), []);
  const openHistoryDrawer = useCallback(() => setHistoryOpen(true), []);
  const closeHistoryDrawer = useCallback(() => setHistoryOpen(false), []);

  const zoomIn = () => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP));
  const zoomOut = () => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP));

  const removeAnnotationAt = (id: number) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再删除标注');
      return;
    }
    const index = regions.findIndex((region) => region.id === id);
    if (index < 0) return;
    painter.current?.removeRegion(id);
    setAnnotationDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // 快捷键：H/B/E/R/O 切工具，Ctrl+Z 撤回，Ctrl+Shift+Z 恢复，+/- 缩放
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) painter.current?.redo();
        else painter.current?.undo();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP));
        return;
      }
      if (event.key === '-') {
        setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP));
        return;
      }
      const toolKey = TOOLS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase());
      if (toolKey) setTool(toolKey.value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (inputs: ToolAsset[], settings: { ratio: string; resolution: string }) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再提交');
      return;
    }
    const submitRegions = painter.current?.getRegionBounds() ?? regions;
    if (submitRegions.length === 0) {
      message.warning('请先在图片上标注需要重绘的区域');
      return;
    }
    const missingDescription = submitRegions.some(
      (region) => !annotationDrafts[region.id]?.prompt.trim(),
    );
    if (missingDescription) {
      message.warning('请为每个标注区域填写重绘描述');
      return;
    }
    const annotations = submitRegions.map((region, index) => ({
      annotationId: String(region.id),
      label: `标注${index + 1}`,
      instruction: annotationDrafts[region.id]!.prompt.trim(),
      referenceAssetId: annotationDrafts[region.id]?.reference?.id ?? null,
      bounds: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        sourceWidth: region.sourceWidth,
        sourceHeight: region.sourceHeight,
      },
    }));
    const parts = annotations.map((item) => `${item.label}：${item.instruction}`);

    const sourceId = inputs[0]?.id ?? null;
    if (maskSourceIdRef.current !== sourceId) {
      maskBlobRef.current = null;
      maskAssetIdRef.current = null;
      maskSourceIdRef.current = sourceId;
    }
    let maskAssetId: string | undefined;
    try {
      setPreparing(true);
      const freshBlob = await painter.current?.toBlob();
      const blob = freshBlob ?? maskBlobRef.current;
      if (!blob) {
        message.warning('请先在图片上标注需要重绘的区域');
        return;
      }
      if (freshBlob) {
        maskBlobRef.current = freshBlob;
        maskAssetIdRef.current = null;
      }
      if (!maskAssetIdRef.current) {
        const projectId = await ensureProject();
        const file = new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' });
        const asset = await assetsApi.upload(file, projectId);
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
      prompt: parts.join('；'),
      annotations: JSON.stringify(annotations),
      modelGuideAssetId: maskAssetId,
      strength: Math.min(1, Math.max(0, brush / 60)),
      ratio: settings.ratio,
      size: settings.resolution,
      ...(settings.ratio !== 'original' ? { imageRatio: settings.ratio } : {}),
      ...(maskAssetId ? { maskAssetId } : {}),
      outputCount: 1,
    });
  };

  /** 每个有效区域必须逐区填写描述；最多 3 条与画布限制一致。 */
  const filledCount = regions.filter((region) => annotationDrafts[region.id]?.prompt.trim()).length;
  const formValid =
    painted && regions.length > 0 && filledCount === regions.length && !uploadBusy && !preparing;

  return (
    <ToolShell
      capability="local_redraw"
      pageClass={`local-redraw-page${historyCollapsed ? ' history-collapsed' : ''}`}
      title="局部重绘"
      desc="只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      requiredInputs={['mask']}
      replaceUpload
      onImagesChange={handleImagesChange}
      renderUploadPreview={(uploaded, controls) => {
        const image = uploaded[0];
        if (!image) return null;
        return (
          <LocalRedrawUploadPreview
            image={image}
            uploading={controls.uploading}
            onPreview={() => controls.preview(image)}
            onRemove={() => controls.remove(image.id)}
            onOpen={controls.open}
          />
        );
      }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="开始重绘"
      emptyDesc="上传图片并标注区域、写下描述后，重绘结果将在此处展示"
      formValid={formValid}
      /*
       * uploadBusy 只通过 formValid 禁用提交，不能并入 submitting：ToolShell 在
       * submitting 时会用生成态替换 sourcePane，画布会被卸载，参考图上传完成
       * 后重建并清空刚画好的遮罩。遮罩上传也只通过 formValid 阻止重复提交，
       * 不切换生成态 —— 上传失败时用户仍保留画布上的笔迹，可直接重试。
       */
      submitting={submitting}
      result={result}
      resultView="canvas"
      generatingAspect={sourceAspect}
      onHistoryReuse={handleHistoryReuse}
      onSubmit={submit}
      resultActions={
        result ? (
          <button type="button" className="tool-result-action" onClick={handleReannotation}>
            重新标注
          </button>
        ) : null
      }
      keepSourceWhileSubmitting
      trailingPane={
        <LocalRedrawHistoryPane
          tasks={history}
          loading={historyLoading}
          error={historyError}
          collapsed={historyCollapsed}
          drawerOpen={historyOpen}
          onToggle={toggleHistory}
          onExpand={expandHistory}
          onOpenDrawer={openHistoryDrawer}
          onCloseDrawer={closeHistoryDrawer}
          onRetry={retryHistory}
        />
      }
      sourcePane={(images) => {
        const image = images[0];
        if (!image) return <LocalRedrawIntro />;
        return (
          <LocalRedrawStage
            image={image}
            tool={tool}
            brush={brush}
            zoom={zoom}
            pan={pan}
            aspect={sourceAspect}
            submitting={submitting}
            canUndo={canUndo}
            canRedo={canRedo}
            busy={uploadBusy}
            painter={painter}
            onToolChange={setTool}
            onBrushChange={setBrush}
            onPanChange={setPan}
            onRegionLimit={handleRegionLimit}
            onPaintState={handlePaintState}
            onNaturalSize={handleNaturalSize}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
        );
      }}
    >
      {(images) => {
        if (images.length === 0) return null;
        return (
          <LocalRedrawAnnotationPanel
            regions={regions}
            drafts={annotationDrafts}
            filledCount={filledCount}
            uploadBusy={uploadBusy}
            referenceUploading={referenceUploading}
            onRemove={removeAnnotationAt}
            onDraftChange={updateAnnotationDraft}
            onUploadReference={uploadReference}
          />
        );
      }}
    </ToolShell>
  );
}
