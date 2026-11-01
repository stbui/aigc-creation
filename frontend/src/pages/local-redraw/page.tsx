import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Drawer } from 'antd';
import { ChevronRight, ChevronUp, Columns2, History, Minus, Plus, Trash2, Undo2, Redo2, X } from 'lucide-react';

import { MAX_ANNOTATIONS, TOOLS, type MaskPainterHandle, type PaintTool } from './constants';
import { MaskPainter } from './MaskPainter';
import { ToolCard, ToolHistoryGrid, ToolShell, type ToolAsset } from './components';
import {
  useAuth,
  useProject,
  useToolTask,
} from './hooks';
import { assetsApi, assetSrc, assetThumbUrl, generateApi } from './api';

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
 */

export function LocalRedrawPage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'local_redraw', successMessage: '重绘结果已生成' });

  const [tool, setTool] = useState<PaintTool>('rect');
  const [brush, setBrush] = useState(30);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [painted, setPainted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [regionCount, setRegionCount] = useState(0);
  /** 最多 3 条标注描述，与参考站一致 */
  const [prompts, setPrompts] = useState<string[]>(['', '', '']);
  /** 遮罩上传期间也要禁用按钮 —— 否则连点会传两份遮罩 */
  const [preparing, setPreparing] = useState(false);
  /** 每条标注可选上传的参考图 */
  const [references, setReferences] = useState<Array<ToolAsset | null>>([null, null, null]);
  /**
   * 正在上传参考图的下标集合。
   *
   * 用集合而不是单个下标: 用户可能连着触发两条标注的上传，若只存一个值，
   * 先完成的请求会把状态提前清空，后一条还在上传时按钮又变成可提交。
   */
  const [referenceUploading, setReferenceUploading] = useState<Set<number>>(() => new Set());
  const uploadBusy = referenceUploading.size > 0;
  /** 历史抽屉 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof generateApi.list>>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  /** 桌面右栏折叠; 窄屏本来就不显示右栏, 改用浮动按钮打开抽屉 */
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [sourceImage, setSourceImage] = useState<ToolAsset | null>(null);
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
  const { token } = useAuth();

  const setPromptAt = (index: number, value: string) =>
    setPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));

  const uploadReference = async (index: number, file: File | undefined) => {
    if (!file) return;
    try {
      setReferenceUploading((prev) => new Set(prev).add(index));
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setReferences((prev) => prev.map((item, i) => (i === index ? { id: asset.id, url: assetSrc(asset) ?? '', name: file.name } : item)));
    } catch (e) {
      message.error((e as Error).message || '参考图上传失败，请重试');
    } finally {
      setReferenceUploading((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  // 历史记录以任务为准；生成完成后刷新一次，首次挂载若有登录态也拉一次。
  useEffect(() => {
    if (!token) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void generateApi
      .list()
      .then((items) => {
        if (cancelled) return;
        setHistory(
          items
            .filter((task) => task.capability === 'local_redraw' && task.status === 'succeeded' && task.outputAsset)
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .slice(0, 20),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setHistory([]);
          setHistoryError((e as Error).message || '历史记录加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, result, historyReload]);

  /** 清掉当前图的遮罩、笔迹状态与结果；源图本身由上传位管理。 */
  const clearMaskSession = useCallback(() => {
    maskBlobRef.current = null;
    maskAssetIdRef.current = null;
    maskSourceIdRef.current = null;
    setPainted(false);
    setCanUndo(false);
    setCanRedo(false);
    setRegionCount(0);
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setResult(null);
  }, [setResult]);

  /** 上传位发生变化时同步源图，并清掉上一张图残留的遮罩与描述。 */
  const handleImagesChange = useCallback(
    (images: ToolAsset[]) => {
      const next = images[0] ?? null;
      const nextId = next?.id ?? null;
      setSourceImage(next);
      if (lastSourceIdRef.current === nextId) return;
      lastSourceIdRef.current = nextId;
      clearMaskSession();
      setPrompts(['', '', '']);
      setReferences([null, null, null]);
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
    setPrompts(['', '', '']);
    setReferences([null, null, null]);
    setSourceImage(null);
    setHistoryOpen(false);
  };

  const historyPane = (
    <>
      <aside className="redraw-history-pane" aria-label="局部重绘历史记录">
        <div className="redraw-history-head">
          <h2>历史记录</h2>
          <button
            type="button"
            className="redraw-history-collapse"
            aria-label={historyCollapsed ? '展开历史记录' : '收起历史记录'}
            aria-expanded={!historyCollapsed}
            title={historyCollapsed ? '展开历史记录' : '收起历史记录'}
            onClick={() => setHistoryCollapsed((value) => !value)}
          >
            {historyCollapsed ? <ChevronRight size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        <div className="redraw-history-scroll">
          <ToolHistoryGrid
            tasks={history}
            loading={historyLoading}
            error={historyError}
            emptyText=""
            onRetry={() => setHistoryReload((value) => value + 1)}
          />
        </div>
      </aside>

      <button
        type="button"
        className="redraw-history-float-toggle"
        aria-label="历史记录"
        title="历史记录"
        onClick={() => {
          // 桌面端右栏收起后，浮动按钮把右栏展开；窄屏没有右栏，改用抽屉。
          if (window.matchMedia('(max-width: 1180px)').matches) setHistoryOpen(true);
          else setHistoryCollapsed(false);
        }}
      >
        <History size={16} />
      </button>

      <Drawer
        title="历史记录"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size={320}
        styles={{ body: { padding: 12 } }}
      >
        <ToolHistoryGrid
          tasks={history}
          loading={historyLoading}
          error={historyError}
          emptyText=""
          onRetry={() => setHistoryReload((value) => value + 1)}
        />
      </Drawer>
    </>
  );

  const handlePaintState = useCallback(
    (isPainted: boolean, undoable: boolean, redoable: boolean, regions: number) => {
      setPainted(isPainted);
      setCanUndo(undoable);
      setCanRedo(redoable);
      setRegionCount(regions);
    },
    [],
  );

  const removeAnnotationAt = (index: number) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再删除标注');
      return;
    }
    painter.current?.removeRegion(index);
    setPrompts((prev) => [...prev.filter((_, i) => i !== index), '']);
    setReferences((prev) => [...prev.filter((_, i) => i !== index), null]);
  };

  // 快捷键：H/B/E/R/O 切工具，Ctrl+Z 撤回，Ctrl+Shift+Z 恢复，+/- 缩放
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) painter.current?.redo();
        else painter.current?.undo();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(140, z + 10));
        return;
      }
      if (e.key === '-') {
        setZoom((z) => Math.max(70, z - 10));
        return;
      }
      const toolKey = TOOLS.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase());
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
    setSourceImage(inputs[0] ?? null);
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
    } catch (e) {
      message.error((e as Error).message || '遮罩上传失败，请重试');
      return;
    } finally {
      setPreparing(false);
    }

    const annotationCount = Math.max(1, Math.min(MAX_ANNOTATIONS, regionCount));
    const annotations = prompts
      .slice(0, annotationCount)
      .map((p, i) => ({
        annotationId: String(i + 1),
        label: `标注${i + 1}`,
        instruction: p.trim(),
        referenceAssetId: references[i]?.id ?? null,
      }))
      .filter((item) => item.instruction);
    const parts = annotations.map((item) => `${item.label}：${item.instruction}`);
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

  const currentResult = Array.isArray(result) ? result[0] : result;
  const resultUrl = currentResult?.status === 'succeeded' ? currentResult.url : undefined;
  /** 与参考站一致: 未标注时只给一条描述位; 标注后按区域数展开, 最多 3 条 */
  const visiblePromptCount = Math.max(1, Math.min(MAX_ANNOTATIONS, regionCount));
  const filledCount = prompts.slice(0, visiblePromptCount).filter((p) => p.trim()).length;

  return (
    <>
    <ToolShell
      capability="local_redraw"
      pageClass={`local-redraw-page${historyCollapsed ? ' history-collapsed' : ''}`}
      title="局部重绘"
      desc="只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      replaceUpload
      onImagesChange={handleImagesChange}
      renderUploadPreview={(uploaded, controls) => {
        const image = uploaded[0];
        if (!image) return null;
        return (
          <div className={`source-row${controls.uploading ? ' processing' : ''}`}>
            <button
              type="button"
              className="local-source-preview"
              aria-label="预览待重绘商品"
              onClick={() => controls.preview(image)}
            >
              <img src={assetThumbUrl(image.url, 320) ?? image.url} alt="待重绘商品" draggable={false} />
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
      settings={{ ratio: true, resolution: true }}
      submitLabel="开始重绘"
      emptyDesc="上传图片并标注区域、写下描述后，重绘结果将在此处展示"
      formValid={painted && filledCount > 0 && !uploadBusy && !preparing}
      /*
       * uploadBusy 只通过 formValid 禁用提交，不能并入 submitting：ToolShell 在
       * submitting 时会用生成态替换 sourcePane，画布会被卸载，参考图上传完成
       * 后重建并清空刚画好的遮罩。遮罩上传也只通过 formValid 阻止重复提交，
       * 不切换生成态 —— 上传失败时用户仍保留画布上的笔迹，可直接重试。
       */
      submitting={submitting}
      result={result}
      resultTag={painted ? '已标注区域' : undefined}
      resultCompare={resultUrl && sourceImage ? { beforeUrl: sourceImage.url, beforeLabel: '原图', afterLabel: '重绘后' } : undefined}
      onHistoryReuse={handleHistoryReuse}
      onSubmit={(inputs, settings) => submit(inputs, settings)}
      resultActions={
        result ? (
          <button type="button" className="tool-result-action" onClick={handleReannotation}>
            重新标注
          </button>
        ) : null
      }
      keepSourceWhileSubmitting
      trailingPane={historyPane}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) {
          return (
            <div className="redraw-intro">
              <video
                className="redraw-intro-video"
                src="/static/mp4/local-redraw.mp4"
                autoPlay
                loop
                muted
                playsInline
                aria-label="局部重绘演示"
              />
              <div className="redraw-intro-copy">
                <strong>局部重绘</strong>
                <p>只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素</p>
              </div>
            </div>
          );
        }
        const renderToolButton = (value: PaintTool) => {
          const item = TOOLS.find((t) => t.value === value);
          if (!item) return null;
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
          <div className={`pk-source-pane redraw-stage${submitting ? ' is-submitting' : ''}`} aria-busy={submitting}>
            <div className="redraw-stage-topbar">
              <div className="redraw-toolbar" role="toolbar" aria-label="重绘工具">
                {renderToolButton('hand')}
                {renderToolButton('eraser')}
                <button
                  type="button"
                  className="redraw-tool-btn"
                  title="对比"
                  disabled
                >
                  <Columns2 size={16} />
                  对比
                </button>
                {renderToolButton('rect')}
                {renderToolButton('ellipse')}
                {renderToolButton('brush')}
                <label className="redraw-toolbar-brush">
                  <span className="sr-only">画笔大小</span>
                  <input
                    aria-label="画笔大小"
                    type="range"
                    min={10}
                    max={60}
                    step={2}
                    value={brush}
                    style={{ '--range-progress': `${((brush - 10) / 50) * 100}%` } as React.CSSProperties}
                    onChange={(e) => setBrush(Number(e.target.value))}
                  />
                  <output>{brush}</output>
                </label>
              </div>
            </div>
            <div className="redraw-stage-main">
              <div className="redraw-canvas-wrap">
                <MaskPainter
                  url={image.url}
                  tool={tool}
                  brush={brush}
                  zoom={zoom}
                  pan={pan}
                  maxRegions={MAX_ANNOTATIONS}
                  onPanChange={setPan}
                  onRegionLimit={() => message.warning(`最多支持 ${MAX_ANNOTATIONS} 个标注区域，请先撤回或删除一个`) }
                  onChange={handlePaintState}
                  handleRef={painter}
                />
              </div>
            </div>
            <div className="redraw-canvas-footer">
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canUndo || uploadBusy}
                title="撤回 (Ctrl+Z)"
                onClick={() => painter.current?.undo()}
              >
                <Undo2 size={16} />
                撤回
              </button>
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canRedo || uploadBusy}
                title="恢复 (Ctrl+Shift+Z)"
                onClick={() => painter.current?.redo()}
              >
                <Redo2 size={16} />
                恢复
              </button>
              <button type="button" className="redraw-footer-btn" disabled={uploadBusy} onClick={() => painter.current?.clear()}>
                <Trash2 size={16} />
                清空
              </button>
              <span className="redraw-tool-divider" />
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="缩小" title="缩小 (-)" onClick={() => setZoom((z) => Math.max(70, z - 10))}>
                <Minus size={16} />
              </button>
              <span className="redraw-zoom-value">{zoom}%</span>
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="放大" title="放大 (+)" onClick={() => setZoom((z) => Math.min(140, z + 10))}>
                <Plus size={16} />
              </button>
            </div>
            <p className="redraw-shortcut-hint">
              快捷键：H 抓手 · B 涂抹 · E 擦除 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
            </p>
          </div>
        );
      }}
    >
      {(images) => {
        if (images.length === 0) return null;
        return (
          <>
            <ToolCard
              title={<><i className="pk-required-mark">*</i>重绘描述</>}
              actions={<span>{filledCount}/{MAX_ANNOTATIONS}</span>}
              className="prompt-card"
            >
              {prompts.slice(0, visiblePromptCount).map((prompt, index) => (
                <div key={index} className={`redraw-prompt${index < regionCount ? '' : ' is-pending'}`}>
                  {index < regionCount && (
                    <button
                      type="button"
                      className="remove-annotation"
                      aria-label={`删除标注${index + 1}`}
                      title={`删除标注${index + 1}`}
                      disabled={uploadBusy}
                      onClick={() => removeAnnotationAt(index)}
                    >
                      <X size={13} />
                    </button>
                  )}
                  <label className={`redraw-prompt-label${index < regionCount ? ' is-marked' : ' is-pending'}`}>
                    <i />
                    标注{index + 1}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={prompt}
                    placeholder="请输入您要重绘的内容，例如：更换颜色..."
                    onChange={(e) => setPromptAt(index, e.target.value)}
                  />
                  <label
                    className={`redraw-prompt-tools reference-upload${references[index] ? ' has-image' : ''}`}
                    title={references[index] ? `替换标注${index + 1}参考图` : `上传标注${index + 1}参考图`}
                  >
                    {references[index] && (
                      <>
                        <img src={assetThumbUrl(references[index]!.url, 240) ?? references[index]!.url} alt={`标注${index + 1}参考图`} />
                        <button
                          type="button"
                          className="remove-reference"
                          aria-label={`移除标注${index + 1}参考图`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setReferences((prev) => prev.map((item, i) => (i === index ? null : item)));
                          }}
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                    {referenceUploading.has(index) && !references[index] ? (
                      <span>上传中…</span>
                    ) : !references[index] ? (
                      <>
                        <Plus size={16} />
                        <span>上传图片</span>
                      </>
                    ) : null}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      disabled={referenceUploading.has(index)}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        void uploadReference(index, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              ))}
            </ToolCard>
          </>
        );
      }}
    </ToolShell>

    </>
  );
}
