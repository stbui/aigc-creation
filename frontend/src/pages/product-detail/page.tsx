import { useCallback, useMemo, useState } from 'react';

import { MAX_DESC_LEN, MAX_IMAGE_MB, MAX_IMAGES } from './constants';
import {
  AssetLibraryModal,
  ExpandTextModal,
  MobileUploadModal,
  ToolBatchOutputPane,
  ToolWorkflowSteps,
} from './components';
import { DetailExamplePanel } from './DetailExamplePanel';
import { DetailInputPane } from './DetailInputPane';
import {
  hasActiveGalleryItems,
  notifyCreditsChanged,
  useAuth,
  useCapabilityRuntime,
  useGenerateError,
  useGenerationSettings,
  useIdempotencyKey,
  useImageToPromptAnalysis,
  useImageUpload,
  useModelQuoteCreditLabel,
  useProject,
  useResultGallery,
  useRightTab,
  useSectionSelection,
  type GalleryItem,
} from './hooks';
import {
  DETAIL_CAPABILITY,
  removeDetailGeneration,
  resolveModelKey,
  startDetailGeneration,
} from './api';
import {
  countGenerations,
  formSnapshotOf,
  labelOf,
  platformDetailSpec,
  sectionCaption,
  type ResultRow,
} from './utils';
import { useApp } from '../../ui';

/**
 * 商品详情图工作台
 *
 * 左右分栏：左栏（输入）与右栏（功能示例 / 创作结果）拆成独立展示组件，
 * 本文件只保留路由级状态、取数与写操作（提交 / 删除）。
 */

export function ProductDetailPage() {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { keyFor: idempotencyKeyFor, reset: resetIdempotencyKey } = useIdempotencyKey();
  // 上传 (三重校验 / 素材库回填 / 粘贴) 统一由 useImageUpload 处理
  const { images, uploading, fileInputRef, uploadFiles, removeImage, replaceImages, library, mobile } = useImageUpload({
    max: MAX_IMAGES,
    maxMb: MAX_IMAGE_MB,
  });
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
    pick,
  } = library;

  // ── 表单状态 ──
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [language, setLanguage] = useState('zh-CN');
  const [description, setDescription] = useState('');
  // 包含模块: 上限、顺序归一化与默认勾选都在 useSectionSelection + DetailSectionPicker
  const { sections, toggle: toggleSection, applySelection } = useSectionSelection();
  // 平台 / 比例 / 画质 / 高级设置开合：详情图比例独立选择，不跟随平台预设
  const {
    platform,
    ratio,
    resolution,
    settingsOpen,
    changePlatform,
    changeRatio,
    changeResolution,
    toggleSettings,
    applySettings,
  } = useGenerationSettings({
    defaultRatio: '3:4',
    defaultResolution: '1k',
    specOf: platformDetailSpec,
    trackRatio: false,
  });

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  // AI 分析：走文本通道的「图片转提示词」，对首张商品图做真实识别
  const { analyzing, analyze: runAiAnalyze } = useImageToPromptAnalysis({
    images,
    value: description,
    onApply: setDescription,
  });

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  // 价签按已选模块数折算；限时免费与后台改价由运行时价 / 模型报价给出
  const { label: creditLabel, onModelQuoteChange } = useModelQuoteCreditLabel({
    capability: DETAIL_CAPABILITY,
    count: sections.length,
    freeLabel: '限时免费',
  });
  const { blocked: capabilityBlocked, reason: capabilityReason } = useCapabilityRuntime(DETAIL_CAPABILITY);
  // ── 右侧结果栏 ──
  //
  // 一次生成 = 服务端按模块拆出的 N 个任务 (每张各计一次费), 全部带同一个
  // batchId; 结果栏按批次聚合成「一行一次生成」。失败任务也要进列表 ——
  // 少一张图时用户需要看到是哪个模块失败了, 而不是数字对不上。
  const { token } = useAuth();
  const gallery = useResultGallery({
    capability: DETAIL_CAPABILITY,
    token,
    captionOf: sectionCaption,
    includeFailed: true,
  });
  // 服务端仍有 queued/running 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢。
  // 只认这两个状态 —— 失败任务同样没有 url, 按「无图」判断会让提交按钮永久禁用。
  const galleryRunning = useMemo(() => hasActiveGalleryItems(gallery.items), [gallery.items]);
  const generating = submitting || galleryRunning;
  /** 页签角标的「生成了几次」 = 结果行数, 与下方列表逐行对应 */
  const generationCount = useMemo(() => countGenerations(gallery.items), [gallery.items]);

  // 结果栏的空态节点与文案都是常量: 固定引用, 结果列表 (memo) 不因输入框按键重建
  const resultEmptyChildren = useMemo(() => <ToolWorkflowSteps />, []);
  const resultEmptyDesc = useMemo(
    () =>
      token
        ? '生成后，每个模块都会得到一张图，按次陈列在这里'
        : '登录后，你在这个页面生成过的图都会显示在这里',
    [token],
  );
  // 首访落在「功能示例」, 有历史产出时自动切到「创作结果」; 用户点过页签后不再自动切换
  const { rightTab, pick: pickRightTab, showResults } = useRightTab(
    gallery.items.length,
    gallery.loading,
  );

  const formValid = useMemo(
    () =>
      images.length > 0 &&
      productName.trim().length > 0 &&
      description.trim().length > 0 &&
      sections.length > 0,
    [images.length, productName, description, sections.length],
  );

  // ── 生成 ──
  const submit = async () => {
    if (!formValid || generating) return;
    // guest 点击仍应走登录弹窗；已登录时才把「能力不可用」作为硬拦截。
    if (token && capabilityBlocked) {
      message.warning(capabilityReason || '该能力当前不可提交');
      return;
    }
    setSubmitting(true);
    // 提交后视线应落在结果区: 生成占位卡在那里, 留在示例页看不到进度
    showResults();
    try {
      const projectId = await ensureProject();
      const modelKey = await resolveModelKey(DETAIL_CAPABILITY);
      /*
       * 服务端按勾选模块把这次提交拆成 N 个任务 (每张各扣一次单价),
       * 每个任务携带自己的模块提示词并发执行,
       * 返回 batchId / batchSize / 本次合计积分。这里**不单点轮询某一任务** ——
       * 首张完成不代表整套图完成; 重拉一次列表拿到全部占位卡,
       * 之后 useResultGallery 会一直轮询到整批任务都到终态。
       */
      const input = {
        projectId,
        modelKey,
        inputAssetIds: images.map((x) => x.id),
        productName,
        brand,
        platform,
        language,
        description,
        sections,
        ratio,
        resolution,
      };
      // 同一次提交的网络重试复用同一个幂等键；拿到任务后再清空
      const idempotencyKey = idempotencyKeyFor(JSON.stringify(input));
      const started = await startDetailGeneration({ ...input, idempotencyKey });
      await gallery.reload();
      // 任务已创建且列表已刷新成功；之后的主动再生成才是新批次
      resetIdempotencyKey();
      const shotCount = started.batchSize ?? 1;
      // 金额以后端返回的合计为准：限时免费 / 后台改价时前端自己算的价会不准
      message.success(
        started.creditCost
          ? `已提交 ${shotCount} 张模块图，本次扣除 ${started.creditCost} 积分`
          : `已提交 ${shotCount} 张模块图（本次免费），生成完成后自动更新`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  /**
   * 删除一次生成 —— 只发一个请求, 删批次里的父任务 (见 `removeDetailGeneration`)。
   */
  const deleteRow = useCallback(
    (items: GalleryItem[]) => {
      const parent = items.find((item) => Number(item.params?.batchIndex) === 1) ?? items[0];
      if (!parent) return;
      modal.confirm({
        title: `删除这次生成的 ${items.length} 张图？`,
        content: '生成图与本地文件会一并删除，不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await removeDetailGeneration(parent.id);
          } catch (e) {
            message.error((e as Error).message || '删除失败，请刷新后重试');
            return;
          }
          // 逐张摘除是批内 N 次 setState, React 会合并成一次渲染
          for (const item of items) gallery.removeItem(item.id);
          message.success('已删除这次生成的全部图片');
        },
      });
    },
    [modal, message, gallery.removeItem],
  );

  /**
   * 重新生成：把一次历史生成的参数回填到左栏，由用户确认 / 调整后再提交。
   *
   * 只回填、不直接建任务 —— 价格与模型线路可能已经变化，是否真的再生成一次
   * 必须由用户按下「立即生成」；回填的模块清单还会按当前能力过滤未知项。
   * 原图素材被删除时保留文字参数并明确提示重传，不静默提交一次缺图任务。
   */
  const regenerateFromRow = useCallback(
    (row: ResultRow) => {
      const snapshot = formSnapshotOf(row.cells);
      if (!snapshot) return;
      setProductName(snapshot.productName);
      setBrand(snapshot.brand);
      setDescription(snapshot.description);
      // 旧任务可能缺这些参数: 缺省时保留当前值，避免把下拉框清空成空串
      if (snapshot.platform) changePlatform(snapshot.platform);
      if (snapshot.language) setLanguage(snapshot.language);
      applySettings({ ratio: snapshot.ratio, resolution: snapshot.resolution });
      if (snapshot.sections.length > 0) applySelection(snapshot.sections);
      if (snapshot.images.length > 0) {
        replaceImages(snapshot.images);
        message.success('已带入这次生成的参数，可在左侧调整后重新生成');
      } else {
        message.warning('原图已不可用，已带入文字参数，请重新上传商品图');
      }
    },
    [applySettings, applySelection, changePlatform, replaceImages, message],
  );

  const canSubmit = formValid && !(token && capabilityBlocked);

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <DetailInputPane
        images={images}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onFiles={(f) => void uploadFiles(f)}
        onRemove={removeImage}
        onOpenLibrary={openLibrary}
        onOpenMobile={mobile.openMobile}
        productName={productName}
        onProductNameChange={setProductName}
        brand={brand}
        onBrandChange={setBrand}
        platform={platform}
        onPlatformChange={changePlatform}
        language={language}
        onLanguageChange={setLanguage}
        description={description}
        onDescriptionChange={setDescription}
        analyzing={analyzing}
        onAnalyze={() => void runAiAnalyze()}
        onExpandDescription={() => setExpandOpen(true)}
        sections={sections}
        onToggleSection={toggleSection}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
        ratio={ratio}
        onRatioChange={changeRatio}
        resolution={resolution}
        onResolutionChange={changeResolution}
        onModelQuoteChange={onModelQuoteChange}
        generating={generating}
        submitDisabled={!canSubmit}
        submitHint={capabilityBlocked && token && capabilityReason ? capabilityReason : undefined}
        creditLabel={creditLabel}
        onSubmit={() => void submit()}
      />

      {/* ── 右: 功能示例 / 创作结果 ──
          创作结果按批次逐行陈列 (一次生成一行, 原图 + 各模块图);
          提交后重拉列表拿到整批占位卡, 由 useResultGallery 轮询到全部到终态。 */}
      <ToolBatchOutputPane
        rightTab={rightTab}
        onPickTab={pickRightTab}
        generationCount={generationCount}
        demo={<DetailExamplePanel />}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        emptyDesc={resultEmptyDesc}
        emptyChildren={resultEmptyChildren}
        onDeleteRow={deleteRow}
        onRegenerateRow={regenerateFromRow}
        labelOf={labelOf}
        downloadNamePrefix="product-detail"
      />

      {/* 素材库选择弹窗 (真实数据) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={MAX_IMAGES}
      />

      {/* 手机上传弹窗 (二维码方案) */}
      <MobileUploadModal open={mobile.open} onReceived={mobile.addAssets} onCancel={mobile.closeMobile} />

      {/* 商品描述放大编辑 */}
      <ExpandTextModal
        open={expandOpen}
        title="编辑商品描述"
        value={description}
        maxLength={MAX_DESC_LEN}
        placeholder="* 请输入商品描述"
        onChange={setDescription}
        onClose={() => setExpandOpen(false)}
      />
    </div>
  );
}
