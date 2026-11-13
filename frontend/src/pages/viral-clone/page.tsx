import { useCallback, useEffect, useState } from 'react';

import { AssetLibraryModal, ExpandTextModal, MobileUploadModal } from './components';
import {
  MAX_REQUIREMENT_LEN,
  REQUIREMENT_PLACEHOLDER,
  type CloneDegree,
} from './constants';
import { ViralCloneInputPane } from './ViralCloneInputPane';
import { ViralCloneOutputPane } from './ViralCloneOutputPane';
import {
  hasActiveGalleryItems,
  notifyCreditsChanged,
  useAuth,
  useDeleteGalleryItem,
  useGenerateError,
  useGenerationSettings,
  useHotRemakeAvailability,
  useIdempotencyKey,
  useModelQuoteCreditLabel,
  usePollAbort,
  useProject,
  useResultGallery,
  useRightTab,
  useViralCloneAssets,
  type GalleryItem,
} from './hooks';
import {
  generateApi,
  modelImageInputLimit,
  resolveModel,
  type PublicModelGroup,
} from './api';
import {
  degreeCaption,
  platformSpec,
  pollToResult,
  taskErrorText,
  viralCloneImageInputError,
  viralCloneProductImageLimit,
  type PolledResult,
} from './utils';
import { useApp } from '../../ui';

/**
 * 爆款复刻工作台
 *
 * 左右分栏: 左栏输入 / 右栏「功能示例 / 创作结果」, 右栏与商品详情、商品主图共用
 * `OutputTabsPane` 外壳; 创作结果保留本页特有的「商品图 → 参考图 → 生成图」对照行。
 *
 * 接线: 商品图 + 参考图 → hot_remake 任务 (inputAssetIds 顺序即上传顺序,
 * 后端保序: [0]=商品图 [1]=参考图); 复刻程度 → degree 参数
 * (high_replica=参考图为底替换商品 / reference_style=提取参考图布局重建场景);
 * 复刻要求/名称/品牌 → 任务参数 (中文原文完整下发; 不再有"图内只画 ASCII"的本地兜底);
 * 比例/画质 → ratio / size 参数。
 *
 * 复刻由真实图像模型完成；没有可用模型通道时页面禁用提交， 直调任务会失败并退款。
 */

export function ViralClonePage() {
  const { message } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  // 同一次提交的网络重试复用幂等键，避免重复建单扣费
  const { keyFor: idempotencyKeyFor, reset: resetIdempotencyKey } = useIdempotencyKey();

  // ── 表单状态 ──
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [language, setLanguage] = useState('zh-CN');
  const [requirement, setRequirement] = useState('');
  const [degree, setDegree] = useState<CloneDegree>('high_replica');
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
  } = useGenerationSettings({
    defaultRatio: '1:1',
    defaultResolution: '1k',
    specOf: platformSpec,
  });

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  /** 当前实际会被提交的模型；图片上限必须读它的能力合同，不能只看页面上限。 */
  const [selectedModel, setSelectedModel] = useState<PublicModelGroup | null>(null);
  // 价签按所选模型的实时报价优先，取不到才回落到能力基础价
  const { label: creditLabel, onModelQuoteChange } = useModelQuoteCreditLabel({
    capability: 'hot_remake',
  });
  /** 最近这一次提交的结果 (只用于提示行; 历史产出由 gallery 维护) */
  const [result, setResult] = useState<PolledResult | null>(null);
  const pollSignal = usePollAbort();

  /*
   * 模型选择器默认收在高级设置里，页面进入时也要先解析一次模型。
   * 爆款复刻固定占用 1 张参考图，因此商品图上限 = 模型总图片上限 - 1。
   */
  useEffect(() => {
    let alive = true;
    void resolveModel('hot_remake')
      .then((model) => {
        if (alive) setSelectedModel(model);
      })
      .catch(() => {
        // 目录不可用时保留页面上限；提交前会再次解析并给出准确原因。
      });
    return () => {
      alive = false;
    };
  }, []);
  const modelImageMax = selectedModel ? modelImageInputLimit(selectedModel) : null;
  const imageMax = viralCloneProductImageLimit(modelImageMax);
  // 双图片位 (商品图 / 参考图) 的上传、素材库与手机回填都在这里
  const {
    images,
    reference,
    uploading,
    fileInputRef,
    referenceInputRef,
    uploadFiles,
    uploadReference,
    removeImage,
    clearReference,
    replaceReference,
    removeReferenceAsset,
    libraryMaxSelectable,
    library,
    openLibraryFor,
    mobile,
  } = useViralCloneAssets({ imageMax, modelImageMax });
  const imageInputError = selectedModel
    ? viralCloneImageInputError(selectedModel, images.length + (reference ? 1 : 0))
    : null;

  // ── 右侧结果栏 ──
  //
  // 与商品主图页、商品详情页同构: 右栏是「功能示例 / 创作结果」两个页签,
  // 创作结果按任务逐行陈列完整的「商品图 → 参考图 → 生成图」对照。
  // 首访落在功能示例; 有历史产出时自动切到创作结果, 用户点过页签后不再自动切换。
  const { token } = useAuth();
  const gallery = useResultGallery({ capability: 'hot_remake', token, captionOf: degreeCaption });
  const { rightTab, pick: pickRightTab, showResults } = useRightTab(gallery.items.length, gallery.loading);
  // 服务端仍有 queued/running 任务时也算生成中: 离开页面再回来, 禁用态不丢
  const generating =
    submitting || hasActiveGalleryItems(gallery.items);

  // 参考站本页名称/品牌/复刻要求均为选填, 提交条件 = 商品图 ≥1 + 参考图 =1 + 未超模型图片上限
  const formValid = images.length > 0 && reference !== null && !imageInputError;

  // 该能力此刻能不能生成 (没有可用模型通道 / 后台下线时提前拦住提交)
  const unavailableReason = useHotRemakeAvailability();

  // ── 生成 ──
  const pollTask = useCallback((taskId: string) => pollToResult(taskId, { signal: pollSignal }), [pollSignal]);

  const submit = async () => {
    if (!formValid || !reference || generating) return;
    // 没有可用模型通道: 后端必定 42204 并退款, 不发起这次注定失败的任务
    if (unavailableReason) {
      message.warning(unavailableReason);
      return;
    }
    setSubmitting(true);
    setResult(null);
    // 提交后视线应落在结果区: 本次复刻的占位行在那里, 留在示例页看不到进度
    showResults();
    try {
      // 模型可能刚被切换，提交前按真实落库模型再校验一次总图片数。
      const model = await resolveModel('hot_remake');
      setSelectedModel(model);
      const limitError = viralCloneImageInputError(model, images.length + 1);
      if (limitError) {
        message.warning(limitError);
        return;
      }
      const projectId = await ensureProject();
      const modelKey = model.id;
      const payload = {
        projectId,
        capability: 'hot_remake',
        modelKey,
        // 顺序即语义: [0]=商品图, [1]=参考图 (后端 processTask 按提交序保序)
        inputAssetIds: [...images.map((x) => x.id), reference.id],
        params: {
          productName: productName.trim(),
          brand: brand.trim(),
          platform,
          language,
          requirement: requirement.trim(),
          degree,
          ratio,
          size: resolution,
        },
      };
      const idempotencyKey = idempotencyKeyFor(JSON.stringify(payload));
      const { taskId } = await generateApi.start({ ...payload, idempotencyKey });
      resetIdempotencyKey();
      const done = await pollTask(taskId);
      setResult(done);
      /*
       * 成功的图**直接插到网格首位**, 不回头重拉列表 (与创意生图 / 商品主图同款):
       * 重拉多一次往返, 占位撤下与新图到位之间会出现回弹闪烁。
       */
      if (done.status === 'succeeded' && done.url) {
        const fresh: GalleryItem = {
          id: taskId,
          url: done.url,
          assetId: done.assetId,
          format: done.format,
          width: done.width ?? null,
          height: done.height ?? null,
          createdAt: new Date().toISOString(),
          caption: degreeCaption({ degree }) ?? degree,
          // 顺序与提交一致: 商品图在前, 参考图固定在末位。右侧结果靠它还原对照。
          inputUrls: [...images.map((image) => image.url), reference.url].filter(Boolean),
        };
        gallery.prepend([fresh]);
      }
      if (done.status === 'failed') message.error(`生成失败：${taskErrorText(done.errorCode)}`);
      else message.success('爆款复刻图已生成');
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  /**
   * 把这张生成图放进右侧「上传参考图（爆款图）」位。
   *
   * 本页的产出天然适合当下一轮的参考图 (复刻一张满意的结果, 再微调要求),
   * 而参考图位只有 1 个 —— 直接替换, 不排队, 与上传语义一致。
   */
  const useAsReference = useCallback(
    (item: GalleryItem) => {
      const assetId = item.assetId;
      if (!assetId) {
        // 任务还在但素材已被清理 (后台删过素材): 不能拿一个空 id 去提交
        message.error('这张图片的素材已不存在，无法用作参考图');
        return;
      }
      if (reference?.id === assetId) {
        message.info('该图片已在参考图位');
        return;
      }
      replaceReference({ id: assetId, url: item.url, name: `生成图-${item.id.slice(-6)}` });
      message.success('已放入参考图位，下一轮复刻会以它为参考');
    },
    [message, reference?.id, replaceReference],
  );

  /**
   * 删除一张生成图 —— DELETE /tasks/:id 会连带删掉产出素材与磁盘文件。
   * 产出素材若正占着参考图位，必须一并清掉，否则下一轮会带空 assetId 提交。
   */
  const deleteImage = useDeleteGalleryItem({
    removeItem: gallery.removeItem,
    onDeleted: (item) => {
      if (item.assetId) removeReferenceAsset(item.assetId);
    },
  });

  return (
    <main className="vc-workspace">
      {/* ── 左: 输入栏 ── */}
      <ViralCloneInputPane
        images={images}
        maxImages={imageMax}
        reference={reference}
        uploading={uploading}
        fileInputRef={fileInputRef}
        referenceInputRef={referenceInputRef}
        onProductFiles={(files) => void uploadFiles(files)}
        onReferenceFiles={(files) => void uploadReference(files)}
        onRemoveImage={removeImage}
        onRemoveReference={clearReference}
        onOpenLibrary={openLibraryFor}
        onOpenMobile={mobile.openMobile}
        productName={productName}
        onProductNameChange={setProductName}
        brand={brand}
        onBrandChange={setBrand}
        platform={platform}
        onPlatformChange={changePlatform}
        language={language}
        onLanguageChange={setLanguage}
        requirement={requirement}
        onRequirementChange={setRequirement}
        onExpandRequirement={() => setExpandOpen(true)}
        degree={degree}
        onDegreeChange={setDegree}
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
        unavailableReason={unavailableReason}
        creditLabel={creditLabel}
        onSubmit={() => void submit()}
      />

      <ViralCloneOutputPane
        rightTab={rightTab}
        onPickTab={pickRightTab}
        generationCount={gallery.items.length}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        submitting={submitting}
        images={images}
        reference={reference}
        result={result}
        onDelete={deleteImage}
        onUseAsReference={useAsReference}
      />

      {/* 素材库选择弹窗 (按触发按钮决定写入商品图还是参考图;
          参考图是单张位 → maxSelectable=1) */}
      <AssetLibraryModal
        open={library.open}
        loading={library.loading}
        items={library.items}
        error={library.error}
        onCancel={library.closeLibrary}
        onPick={library.pick}
        maxSelectable={libraryMaxSelectable}
      />

      {/* 手机上传弹窗 (按触发按钮决定写入商品图还是参考图) */}
      <MobileUploadModal
        open={mobile.open}
        onReceived={mobile.addAssets}
        onCancel={mobile.closeMobile}
      />

      <ExpandTextModal
        open={expandOpen}
        title="编辑复刻要求"
        value={requirement}
        maxLength={MAX_REQUIREMENT_LEN}
        placeholder={REQUIREMENT_PLACEHOLDER}
        onChange={setRequirement}
        onClose={() => setExpandOpen(false)}
      />
    </main>
  );
}
