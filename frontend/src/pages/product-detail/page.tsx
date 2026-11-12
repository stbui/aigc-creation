import { useCallback, useMemo, useRef, useState } from 'react';

import { MAX_DESC_LEN, MAX_IMAGE_MB, MAX_IMAGES } from './constants';
import { AssetLibraryModal, MobileUploadModal, ToolWorkflowSteps } from './components';
import { DetailInputPane } from './DetailInputPane';
import { DetailOutputPane } from './DetailOutputPane';
import {
  notifyCreditsChanged,
  useAuth,
  useCapabilityRuntime,
  useDetailCreditLabel,
  useGenerateError,
  useImageUpload,
  useProject,
  useResultGallery,
  useRightTab,
  useSectionSelection,
  type GalleryItem,
} from './hooks';
import {
  analyzeImageToPrompt,
  DETAIL_CAPABILITY,
  newIdempotencyKey,
  removeDetailGeneration,
  resolveModelId,
  startDetailGeneration,
} from './api';
import { countGenerations, formSnapshotOf, platformDetailSpec, sectionCaption, type ResultRow } from './utils';
import { promptToolErrorMessage } from '../../lib/promptToolMessages';
import { useApp, Modal, Textarea } from '../../ui';

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
  const [platform, setPlatform] = useState('taobao');
  const [language, setLanguage] = useState('zh-CN');
  const [description, setDescription] = useState('');
  // 包含模块: 上限、顺序归一化与默认勾选都在 useSectionSelection + DetailSectionPicker
  const { sections, toggle: toggleSection, applySelection } = useSectionSelection();
  const [ratio, setRatio] = useState('3:4');
  const [resolution, setResolution] = useState('1k');
  /** 用户手动改过画质后，切换平台不再覆盖 */
  const [resolutionTouched, setResolutionTouched] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** AI 分析进行中 (按钮禁用 + 文案切换, 防止连点时重复请求文本通道) */
  const [analyzing, setAnalyzing] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  /** 一次详情图提交会拆成 N 个任务，网络重试必须复用同一个幂等键 */
  const pendingStartRef = useRef<{ fingerprint: string; key: string } | null>(null);
  /** 所选模型的实时单张报价（积分） */
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);
  // 实时价优先取模型报价，取不到才回落到能力清单基础价
  const baseCreditLabel = useDetailCreditLabel(sections.length);
  const creditLabel = useMemo(() => {
    if (modelQuoteCredits == null) return baseCreditLabel;
    if (modelQuoteCredits === 0) return '限时免费';
    return `本次约 ${modelQuoteCredits * Math.max(sections.length, 1)} 积分（按所选模型）`;
  }, [baseCreditLabel, modelQuoteCredits, sections.length]);
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
  const generating = useMemo(
    () => submitting || gallery.items.some((item) => item.status === 'queued' || item.status === 'running'),
    [submitting, gallery.items],
  );
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

  /** 切换平台：用户没手动改过画质时，带出该平台的详情长图规格 */
  const changePlatform = (value: string) => {
    setPlatform(value);
    const spec = platformDetailSpec(value);
    if (spec?.size && !resolutionTouched) setResolution(spec.size);
  };

  // ── AI分析: 走文本通道的「图片转提示词」, 对首张商品图做真实识别 ──
  //
  // 失败语义: 文本通道没配时后端返回 502, 如实把原因抛给用户;
  // 绝不退回「用文件名拼一段描述」—— 那会让用户以为模型看过图。
  const runAiAnalyze = async () => {
    if (images.length === 0) {
      message.warning('请先上传商品图片');
      return;
    }
    const first = images[0];
    if (!first?.id) {
      message.warning('首张图缺少素材 id，请重新上传后再分析');
      return;
    }
    setAnalyzing(true);
    try {
      const { text } = await analyzeImageToPrompt(first.id);
      const content = text?.trim();
      if (!content) {
        message.warning('这次没有生成可用内容，请重试');
        return;
      }
      // 已填过描述时不静默覆盖, 先问一句
      if (description.trim()) {
        modal.confirm({
          title: '替换商品描述？',
          content: 'AI 分析会覆盖当前已填写的描述。',
          okText: '替换',
          cancelText: '取消',
          onOk: () => setDescription(content),
        });
        return;
      }
      setDescription(content);
      message.success('已按首张商品图生成描述，可继续编辑');
    } catch (e) {
      message.error(promptToolErrorMessage(e, 'image'));
    } finally {
      setAnalyzing(false);
    }
  };

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
      const logicalModelId = await resolveModelId(DETAIL_CAPABILITY);
      /*
       * 服务端按勾选模块把这次提交拆成 N 个任务 (每张各扣一次单价),
       * 每个任务携带自己的模块提示词并发执行,
       * 返回 batchId / batchSize / 本次合计积分。这里**不单点轮询某一任务** ——
       * 首张完成不代表整套图完成; 重拉一次列表拿到全部占位卡,
       * 之后 useResultGallery 会一直轮询到整批任务都到终态。
       */
      const input = {
        projectId,
        logicalModelId,
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
      const fingerprint = JSON.stringify(input);
      const idempotencyKey =
        pendingStartRef.current?.fingerprint === fingerprint
          ? pendingStartRef.current.key
          : newIdempotencyKey();
      pendingStartRef.current = { fingerprint, key: idempotencyKey };
      const started = await startDetailGeneration({ ...input, idempotencyKey });
      await gallery.reload();
      // 任务已创建且列表已刷新成功；之后的主动再生成才是新批次
      pendingStartRef.current = null;
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
      if (snapshot.platform) setPlatform(snapshot.platform);
      if (snapshot.language) setLanguage(snapshot.language);
      if (snapshot.ratio) setRatio(snapshot.ratio);
      if (snapshot.resolution) {
        setResolution(snapshot.resolution);
        // 画质是随这批任务恢复的，之后切平台不应再覆盖用户看到的值
        setResolutionTouched(true);
      }
      if (snapshot.sections.length > 0) applySelection(snapshot.sections);
      if (snapshot.images.length > 0) {
        replaceImages(snapshot.images);
        message.success('已带入这次生成的参数，可在左侧调整后重新生成');
      } else {
        message.warning('原图已不可用，已带入文字参数，请重新上传商品图');
      }
    },
    [applySelection, replaceImages, message],
  );

  /** 放大编辑弹窗的开 / 关 (两处回调共用同一引用) */
  const closeExpand = useCallback(() => setExpandOpen(false), []);
  const openExpand = useCallback(() => setExpandOpen(true), []);
  /*
   * 高级设置的开合。必须是稳定引用: ToolSettingsPopover 的「点外部 / Esc 收起」
   * 监听器以该回调为依赖, 每次按键都换新引用会让监听器反复解绑重绑。
   */
  const toggleSettings = useCallback(() => setSettingsOpen((v) => !v), []);

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
        onExpandDescription={openExpand}
        sections={sections}
        onToggleSection={toggleSection}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
        ratio={ratio}
        onRatioChange={setRatio}
        resolution={resolution}
        onResolutionChange={(v) => {
          setResolutionTouched(true);
          setResolution(v);
        }}
        onModelQuoteChange={setModelQuoteCredits}
        generating={generating}
        submitDisabled={!canSubmit}
        submitHint={capabilityBlocked && token && capabilityReason ? capabilityReason : undefined}
        creditLabel={creditLabel}
        onSubmit={() => void submit()}
      />

      {/* ── 右: 功能示例 / 创作结果 ──
          创作结果按批次逐行陈列 (一次生成一行, 原图 + 各模块图);
          提交后重拉列表拿到整批占位卡, 由 useResultGallery 轮询到全部到终态。 */}
      <DetailOutputPane
        rightTab={rightTab}
        onPickTab={pickRightTab}
        generationCount={generationCount}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        emptyDesc={resultEmptyDesc}
        emptyChildren={resultEmptyChildren}
        onDeleteRow={deleteRow}
        onRegenerateRow={regenerateFromRow}
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
      <Modal
        open={expandOpen}
        title="编辑商品描述"
        okText="确定"
        cancelText="取消"
        onOk={closeExpand}
        onCancel={closeExpand}
      >
        <Textarea
          className="pk-expand-textarea"
          rows={10}
          maxLength={MAX_DESC_LEN}
          value={description}
          placeholder="* 请输入商品描述"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Modal>
    </div>
  );
}
