import { useCallback, useEffect, useMemo, useState } from 'react';

import { MAX_IMAGE_MB, MAX_IMAGES, VARIANT_FIELDS } from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  ToolWorkflowSteps,
  type PublicLogicalModel,
} from './components';
import { ProductKitDescriptionModal } from './ProductKitDescriptionModal';
import { ProductKitInputPane } from './ProductKitInputPane';
import { ProductKitOutputPane } from './ProductKitOutputPane';
import {
  useAuth,
  useCreditCost,
  useImageUpload,
  useResultGallery,
  useRightTab,
  type GalleryItem,
} from './hooks';
import { generateApi, promptToolsApi, resolveModel } from './api';
import { promptToolErrorMessage } from '../../lib/promptToolMessages';
import {
  buildVariantPlan,
  countGenerations,
  imageInputCountError,
  modelImageInputLimit,
  platformSpec,
  variantCaption,
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
  const [selectedModel, setSelectedModel] = useState<PublicLogicalModel | null>(null);
  /*
   * 模型选择器位于默认收起的高级设置里，不能依赖它挂载后才上报约束。
   * 页面进入时先解析一次真实模型，上传区才能从第一张图起就按模型上限工作。
   * 之后用户切换模型时由 `ModelPicker.onModelChange` 即时更新。
   */
  useEffect(() => {
    let alive = true;
    void resolveModel('main_image')
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
  const imageMax = Math.min(MAX_IMAGES, modelImageMax ?? MAX_IMAGES);
  // 上传 (三重校验 / 素材库回填 / 粘贴) 统一由 useImageUpload 处理
  const { images, uploading, fileInputRef, uploadFiles, removeImage, replaceImage, library, mobile } = useImageUpload({
    max: imageMax,
    maxMb: MAX_IMAGE_MB,
  });
  const imageInputError = selectedModel ? imageInputCountError(selectedModel, images.length) : null;
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
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(VARIANT_FIELDS.map((v) => [v.key, v.default])),
  );
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  /**
   * 用户手动改过比例/画质后，切换平台不再覆盖 —— 平台规格只是默认值，
   * 不能把用户已经调好的设置抢走。
   */
  const [ratioTouched, setRatioTouched] = useState(false);
  const [resolutionTouched, setResolutionTouched] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** AI 分析进行中 (按钮禁用 + 文案切换, 防止连点时重复请求文本通道) */
  const [analyzing, setAnalyzing] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  /** 所选模型的实时单张报价（积分）；null = 未取到，回落到能力基础价 */
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);
  /*
   * 本页不直接展示 capability runtime 的后台诊断原因；运行时不可用文案统一由
   * `runtimeOf` 转换为用户提示。真正的可用性仍由后端把关（下架走 40005，
   * 无线路由 resolveModelId 在提交时如实报错）。
   */
  // ── 右侧结果栏 ──
  //
  // 与商品详情页同构: 一次提交的服务端任务共享 batchId, 结果栏按批次聚合成
  // 「一行一次生成」。失败任务也进列表, 用户能看到具体是哪一类主图失败。
  const { token } = useAuth();
  const gallery = useResultGallery({
    capability: 'main_image',
    token,
    captionOf: variantCaption,
    includeFailed: true,
  });
  // 只认 queued/running: 失败任务同样没有 url, 按「无图」判断会让提交按钮永久禁用。
  const galleryRunning = useMemo(
    () => gallery.items.some((item) => item.status === 'queued' || item.status === 'running'),
    [gallery.items],
  );
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
  const unitCreditCost = useCreditCost('main_image');
  const creditLabel = useMemo(() => {
    const unit = modelQuoteCredits ?? unitCreditCost;
    if (unit == null) return null;
    if (unit === 0) return '免费';
    const total = unit * Math.max(totalCount, 1);
    return modelQuoteCredits == null ? `本次消耗 ${total} 积分` : `本次约 ${total} 积分（按所选模型）`;
  }, [unitCreditCost, modelQuoteCredits, totalCount]);
  const formValid =
    images.length > 0 &&
    !imageInputError &&
    productName.trim().length > 0 &&
    description.trim().length > 0 &&
    totalCount > 0;

  // 生成提交流程（模型校验 / 素材准备 / 幂等批次 / 顺序建单）收口在独立 hook
  const { submitting, submit } = useProductKitSubmit({
    input: {
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

  /** 切换平台：用户没手动改过比例/画质时，带出该平台的主图规格 */
  const changePlatform = (value: string) => {
    setPlatform(value);
    const spec = platformSpec(value);
    if (!spec) return;
    if (!ratioTouched) setRatio(spec.ratio);
    if (!resolutionTouched) setResolution(spec.size);
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
      const { text } = await promptToolsApi.imageToPrompt(first.id);
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

  /**
   * 删除一次生成 —— 主图批次由多个独立任务组成, 没有 parentTaskId,
   * 因此必须逐张删除；成功的本地摘除, 失败的保留并提示刷新重试。
   *
   * DELETE /tasks/:id 会连带删掉产出素材与磁盘文件, 删除不可逆。
   */
  const deleteRow = useCallback(
    (items: GalleryItem[]) => {
      if (items.length === 0) return;
      modal.confirm({
        title: `删除这次生成的 ${items.length} 张图？`,
        content: '生成图与本地文件会一并删除，不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          const results = await Promise.allSettled(items.map((item) => generateApi.remove(item.id)));
          let removed = 0;
          results.forEach((result, index) => {
            if (result.status !== 'fulfilled') return;
            gallery.removeItem(items[index].id);
            removed += 1;
          });
          if (removed === items.length) {
            message.success('已删除这次生成的全部图片');
            return;
          }
          message.error(`已删除 ${removed} 张，其余删除失败，请刷新后重试`);
          await gallery.reload();
        },
      });
    },
    [modal, message, gallery.removeItem, gallery.reload],
  );

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <ProductKitInputPane
        images={images}
        maxImages={imageMax}
        imageLimitError={imageInputError}
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
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        ratio={ratio}
        onRatioChange={(v) => {
          setRatioTouched(true);
          setRatio(v);
        }}
        resolution={resolution}
        onResolutionChange={(v) => {
          setResolutionTouched(true);
          setResolution(v);
        }}
        onModelQuoteChange={setModelQuoteCredits}
        onModelChange={setSelectedModel}
        generating={generating}
        formValid={formValid}
        creditLabel={creditLabel}
        onSubmit={() => void submit()}
      />

      {/* ── 右: 功能示例 / 创作结果 ── */}
      <ProductKitOutputPane
        rightTab={rightTab}
        onPickTab={pickRightTab}
        generationCount={generationCount}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        emptyDesc={resultEmptyDesc}
        emptyChildren={resultEmptyChildren}
        onDeleteRow={deleteRow}
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
        maxSelectable={MAX_IMAGES}
      />

      {/* 手机上传弹窗 (二维码方案) */}
      <MobileUploadModal open={mobile.open} onReceived={mobile.addAssets} onCancel={mobile.closeMobile} />

      {/* 商品描述放大编辑 */}
      <ProductKitDescriptionModal
        open={expandOpen}
        description={description}
        onChange={setDescription}
        onClose={() => setExpandOpen(false)}
      />
    </div>
  );
}
