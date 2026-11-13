import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  MAX_DESC_LEN,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  PRODUCT_KIT_CAPABILITY,
  VARIANT_FIELDS,
} from './constants';
import {
  AssetLibraryModal,
  ExpandTextModal,
  MobileUploadModal,
  ToolBatchOutputPane,
  ToolWorkflowSteps,
  type PublicModelGroup,
} from './components';
import { ProductKitExamplePanel } from './ProductKitExamplePanel';
import { ProductKitInputPane } from './ProductKitInputPane';
import { ProductKitPromptPreview } from './ProductKitPromptPreview';
import {
  hasActiveGalleryItems,
  useAuth,
  useGenerationSettings,
  useImageToPromptAnalysis,
  useImageUpload,
  useModelQuoteCreditLabel,
  useResultGallery,
  useRightTab,
  type GalleryItem,
} from './hooks';
import { generateApi, resolveModel } from './api';
import {
  buildVariantPlan,
  buildVariantsParam,
  countGenerations,
  formSnapshotOf,
  imageInputCountError,
  labelOf,
  modelImageInputLimit,
  platformSpec,
  variantCaption,
  type ResultRow,
} from './utils';
import { useProductKitSubmit } from './useProductKitSubmit';
import { useApp } from '../../ui';

/**
 * 商品主图工作台
 */

export function ProductKitPage() {
  const { message, modal } = useApp();
  /**
   * 当前模型的能力合同决定实际可提交的图片数。页面上限仍保留 5，
   * 既兼容未来支持 5 张的模型，也避免已有 5 张素材被静默删除。
   */
  const [selectedModel, setSelectedModel] = useState<PublicModelGroup | null>(null);
  /*
   * 模型选择器位于默认收起的高级设置里，不能依赖它挂载后才上报约束。
   * 页面进入时先解析一次真实模型，上传区才能从第一张图起就按模型上限工作。
   * 之后用户切换模型时由 `ModelPicker.onModelChange` 即时更新。
   */
  useEffect(() => {
    let alive = true;
    void resolveModel(PRODUCT_KIT_CAPABILITY)
      .then((model) => {
        if (alive) setSelectedModel(model);
      })
      .catch(() => {
        // 目录不可用时保留页面上限；提交时会再次解析并给出准确原因。
      });
    return () => {
      alive = false;
    };
  }, []);
  const modelImageMax = selectedModel ? modelImageInputLimit(selectedModel) : null;
  const maxImages = Math.min(MAX_IMAGES, modelImageMax ?? MAX_IMAGES);
  // 上传 (三重校验 / 素材库回填 / 粘贴) 统一由 useImageUpload 处理
  const { images, uploading, fileInputRef, uploadFiles, removeImage, replaceImage, replaceImages, library, mobile } = useImageUpload({
    max: maxImages,
    maxMb: MAX_IMAGE_MB,
  });
  const imageLimitError = selectedModel ? imageInputCountError(selectedModel, images.length) : null;
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
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(VARIANT_FIELDS.map((v) => [v.key, v.default])),
  );
  // 平台 / 比例 / 画质 / 高级设置开合：用户手改过的值不再被平台预设覆盖
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
    defaultRatio: '1:1',
    defaultResolution: '1k',
    specOf: platformSpec,
  });

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // AI 分析：走文本通道的「图片转提示词」，对首张商品图做真实识别
  const { analyzing, analyze: runAiAnalyze } = useImageToPromptAnalysis({
    images,
    value: description,
    onApply: setDescription,
  });

  // ── 右侧结果栏 ──
  //
  // 与商品详情页同构: 一次提交的服务端任务共享 batchId, 结果栏按批次聚合成
  // 「一行一次生成」。失败任务也进列表, 用户能看到具体是哪一类主图失败。
  const { token } = useAuth();
  const gallery = useResultGallery({
    capability: PRODUCT_KIT_CAPABILITY,
    token,
    captionOf: variantCaption,
    includeFailed: true,
  });
  // 只认 queued/running: 失败任务同样没有 url, 按「无图」判断会让提交按钮永久禁用。
  const galleryRunning = useMemo(() => hasActiveGalleryItems(gallery.items), [gallery.items]);
  /** 页签角标按生成次数计, 与下方批次行数一致 */
  const generationCount = useMemo(() => countGenerations(gallery.items), [gallery.items]);
  const resultEmptyChildren = useMemo(() => <ToolWorkflowSteps />, []);
  const resultEmptyDesc = useMemo(
    () =>
      token
        ? '提交任务后，每次生成的白底图、场景图和卖点图会按批次陈列在这里'
        : '登录后，你在这个页面生成过的图都会显示在这里',
    [token],
  );
  // 首访落在「功能示例」, 有历史产出时自动切到「创作结果」; 用户点过页签后不再自动切换
  const { rightTab, pick: pickRightTab, showResults } = useRightTab(gallery.items.length, gallery.loading);

  /** 本次张数：与提交时拆出的任务清单同源（都走 `buildVariantPlan`） */
  const totalCount = useMemo(() => buildVariantPlan(counts).length, [counts]);
  /*
   * 价签必须按“本次要出几张”计算。此前只显示单张单价，用户选 3 个变体时
   * 按钮仍写“本次消耗 10 积分”，实际扣 30 —— 属于计费披露错误。
   */
  const { label: creditLabel, onModelQuoteChange } = useModelQuoteCreditLabel({
    capability: PRODUCT_KIT_CAPABILITY,
    count: totalCount,
  });
  const formValid =
    images.length > 0 &&
    !imageLimitError &&
    productName.trim().length > 0 &&
    description.trim().length > 0 &&
    totalCount > 0;

  // 生成提交流程（模型校验 / 素材准备 / 幂等批次 / 顺序建单）收口在独立 hook
  const { submitting, submit } = useProductKitSubmit({
    form: {
      images,
      counts,
      productName,
      brand,
      platform,
      language,
      description,
      ratio,
      resolution,
    },
    canSubmit: formValid,
    running: galleryRunning,
    onReplaceImage: replaceImage,
    onSubmitted: showResults,
    reloadResults: gallery.reload,
  });
  const generating = submitting || galleryRunning;

  /**
   * 删除一次生成 —— 服务端按 outputPlan 建的是「父任务 + 子任务」，
   * 子任务通过 parentTaskId 指向父任务。只删父任务，服务端会连带删除
   * 整批子任务；逐张删会先删掉父任务导致后续子任务 404。
   *
   * DELETE /tasks/:id 会连带删掉产出素材与磁盘文件, 删除不可逆。
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
            await generateApi.remove(parent.id);
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
   * 只回填、不直接建任务 —— 模型价格与线路可能已经变化，是否真的再生成
   * 必须由用户按下「立即生成」。变体张数按整批任务反推，旧任务缺参数时
   * 保留当前配置，不把计数清空成 0。
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
      if (Object.values(snapshot.counts).some((count) => count > 0)) setCounts(snapshot.counts);
      if (snapshot.images.length > 0) {
        replaceImages(snapshot.images);
        message.success('已带入这次生成的参数，可在左侧调整后重新生成');
      } else {
        message.warning('原图已不可用，已带入文字参数，请重新上传商品图');
      }
    },
    [applySettings, changePlatform, replaceImages, message],
  );

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <ProductKitInputPane
        images={images}
        maxImages={maxImages}
        imageLimitError={imageLimitError}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onFiles={(f) => void uploadFiles(f)}
        onRemoveImage={removeImage}
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
        counts={counts}
        onCountChange={(key, value) => setCounts((c) => ({ ...c, [key]: value }))}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
        ratio={ratio}
        onRatioChange={changeRatio}
        resolution={resolution}
        onResolutionChange={changeResolution}
        onModelQuoteChange={onModelQuoteChange}
        onModelChange={setSelectedModel}
        generating={generating}
        formValid={formValid}
        creditLabel={creditLabel}
        onPreviewPrompt={() => setPreviewOpen(true)}
        previewingPrompt={false}
        onSubmit={() => void submit()}
      />

      {/* ── 右: 功能示例 / 创作结果 ── */}
      <ToolBatchOutputPane
        rightTab={rightTab}
        onPickTab={pickRightTab}
        generationCount={generationCount}
        demo={<ProductKitExamplePanel />}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        emptyDesc={resultEmptyDesc}
        emptyChildren={resultEmptyChildren}
        onDeleteRow={deleteRow}
        onRegenerateRow={regenerateFromRow}
        labelOf={labelOf}
        downloadNamePrefix="main-image"
      />

      {/* 素材库选择弹窗 (真实数据) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={maxImages}
      />

      {/* 手机上传弹窗 (二维码方案) */}
      <MobileUploadModal open={mobile.open} onReceived={mobile.addAssets} onCancel={mobile.closeMobile} />

      {/* 生成提示词预览（不建任务、不扣费） */}
      <ProductKitPromptPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        productName={productName}
        brand={brand}
        platform={platform}
        language={language}
        description={description}
        ratio={ratio}
        resolution={resolution}
        variants={buildVariantsParam(counts)}
        refCount={images.length}
      />

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
