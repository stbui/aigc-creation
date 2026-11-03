import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  MAX_IMAGE_MB,
  MAX_IMAGES,
  VARIANT_FIELDS,
} from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  ModelPicker,
  ToolSettingsPopover,
  ToolSubmitBar,
  ToolWorkflowSteps,
  type PublicLogicalModel,
} from './components';
import { ProductKitConfig } from './ProductKitConfig';
import { ProductKitDescriptionModal } from './ProductKitDescriptionModal';
import { ProductKitExamplePanel } from './ProductKitExamplePanel';
import { ProductKitResultList } from './ProductKitResultList';
import { ProductKitSettings } from './ProductKitSettings';
import { ProductKitTabs } from './ProductKitTabs';
import {
  notifyCreditsChanged,
  useAuth,
  useCreditCost,
  useGenerateError,
  useImageUpload,
  useProject,
  useResultGallery,
  useRightTab,
  type GalleryItem,
} from './hooks';
import { generateApi, newIdempotencyKey, promptToolsApi, resolveModel } from './api';
import { promptToolErrorMessage } from '../../lib/promptToolMessages';
import {
  countGenerations,
  ensureAssetsInProject,
  imageInputCountError,
  modelImageInputLimit,
  platformSpec,
  variantCaption,
} from './utils';
import { useApp } from '../../ui';

/**
 * 商品主图工作台
 */

export function ProductKitPage() {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const navigate = useNavigate();
  const { ensureProject } = useProject();
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

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  /** 所选模型的实时单张报价（积分）；null = 未取到，回落到能力基础价 */
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);
  /**
   * 最近一次“尚未拿到全部 taskId”的提交。
   *
   * 顺序建单时如果第 k 个请求网络失败，前 k-1 个任务已在服务端创建；
   * 用户重试必须复用同一批幂等键与 batchId，让后端返回既有任务而不是
   * 再扣一次钱，也避免补建的任务被分到另一行。
   * 拿到全部 taskId 后清空，之后的主动“再生成一次”才是新任务。
   */
  const pendingBatchRef = useRef<{ fingerprint: string; keys: string[]; batchId: string } | null>(null);
  /*
   * 不再读取 capability runtime 在此页展示「该能力需要真实模型才能生成，当前暂不可用」。
   * 该提示是运营/配置侧的内部原因，C 端工作台不展示；真正的可用性仍由后端把关
   * （下架走 40005，无线路由 resolveModelId 在提交时如实报错）。
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
  const generating = useMemo(
    () => submitting || gallery.items.some((item) => item.status === 'queued' || item.status === 'running'),
    [submitting, gallery.items],
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
  const refreshGallery = useCallback(() => {
    void gallery.reload();
  }, [gallery.reload]);

  // 首访落在「功能示例」, 有历史产出时自动切到「创作结果」; 用户点过页签后不再自动切换
  const { rightTab, pick: pickRightTab, showResults } = useRightTab(
    gallery.items.length,
    gallery.loading,
  );

  const totalCount = useMemo(
    () => VARIANT_FIELDS.reduce((sum, v) => sum + (counts[v.key] ?? 0), 0),
    [counts],
  );
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
    return modelQuoteCredits == null
      ? `本次消耗 ${total} 积分`
      : `本次约 ${total} 积分（按所选模型）`;
  }, [unitCreditCost, modelQuoteCredits, totalCount]);
  const formValid =
    images.length > 0 &&
    !imageInputError &&
    productName.trim().length > 0 &&
    description.trim().length > 0 &&
    totalCount > 0;

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

  // ── 生成 ──
  const submit = async () => {
    if (!formValid || generating) return;
    // guest 点击仍应走登录弹窗（generateApi 的 401 → auth:required 契约）
    setSubmitting(true);
    let batchStarted = false;
    // 提交后视线应落在结果区: 整批占位卡在那里, 留在示例页看不到进度
    showResults();

    try {
      /*
       * 模型选择器可能还没完成目录加载，或用户刚切换模型；提交前再按真实
       * 落库模型校验一次。超限时保留全部素材并明确提示，绝不静默截断。
       */
      const model = await resolveModel('main_image');
      const limitError = imageInputCountError(model, images.length);
      if (limitError) {
        message.warning(limitError);
        return;
      }
      const projectId = await ensureProject();
      /*
       * 素材库会展示账号下所有项目的图片，但后端只允许任务引用同项目素材。
       * 跨项目选中时先复制到当前项目；复制成功立即替换输入位，失败则停在
       * 建单之前 —— 绝不把跨项目 asset id 直接提交。
       */
      const preparedImages = await ensureAssetsInProject(images, projectId, {
        onPrepared: replaceImage,
      });
      const inputAssetIds = preparedImages.map((image) => image.id);
      // 一批变体必须落在同一个模型上，解析一次即可；循环里再解析会让
      // 目录缓存过期的瞬间出现「同一批用了两个模型」
      const logicalModelId = model.id;
      // 自定义配置计数 → 每类变体生成 count 张 (与参考站批量出图行为一致)
      const plan: string[] = [];
      for (const v of VARIANT_FIELDS) {
        const n = counts[v.key] ?? 0;
        for (let i = 0; i < n; i++) plan.push(v.key);
      }

      const baseParams = {
        productName: productName.trim(),
        brand: brand.trim(),
        platform,
        language,
        description: description.trim(),
        ratio,
        size: resolution,
      };
      /*
       * 幂等键按“本次输入指纹”复用：某次建单请求在网络层失败后，用户重试
       * 会拿到同一个 key，服务端返回已创建的任务而不是再扣一次钱。
       * 全部 taskId 都拿到后清空，之后的主动再生成才是新任务。
       */
      const fingerprint = JSON.stringify({
        capability: 'main_image',
        projectId,
        logicalModelId,
        inputAssetIds,
        baseParams,
        plan,
      });
      const previous = pendingBatchRef.current?.fingerprint === fingerprint
        ? pendingBatchRef.current
        : null;
      const batchId = previous?.batchId ?? newIdempotencyKey();
      const keys = previous?.keys ?? plan.map(() => newIdempotencyKey());
      pendingBatchRef.current = { fingerprint, keys, batchId };

      // 顺序创建任务: 并行创建曾触发 broker IPC EPIPE, 顺序提交更稳
      for (let i = 0; i < plan.length; i += 1) {
        const variant = plan[i];
        await generateApi.start({
          projectId,
          capability: 'main_image',
          logicalModelId,
          inputAssetIds,
          idempotencyKey: keys[i],
          params: {
            ...baseParams,
            variant,
            batchId,
            batchIndex: i + 1,
            batchSize: plan.length,
          },
        });
        // 只有首个任务真正创建成功后才进入“部分已提交”语义。首单失败时
        // pendingBatchRef 仍在，但不能误报已经落单。
        batchStarted = true;
      }

      // 重拉列表拿到整批占位卡, 之后 useResultGallery 会轮询到全部任务终态
      await gallery.reload();
      // 整批已创建且列表已刷新成功; 之后的主动再生成才是新批次
      pendingBatchRef.current = null;
      message.success(`已提交 ${plan.length} 张商品主图，生成完成后自动更新`);
    } catch (e) {
      reportError(e);
      /*
       * 中途建单失败：已创建的任务不回滚（服务端已扣费）。尽量重拉一次，
       * 让已经落地的占位卡可见；pendingBatchRef 保留，用户重试时复用同一
       * batchId 与幂等键，服务端会返回既有任务并继续补齐缺失张数。
       */
      if (batchStarted) {
        await gallery.reload();
        message.warning('部分商品主图可能已提交，请查看生成记录；重新提交会继续补齐本批');
      }
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
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
      <aside className="pk-input-pane">
        <div className="pk-form-card">
          <ProductKitTabs />

          <div className="pk-form-scroll">
            {/* 上传商品图 + 生成设置 + 商品描述 (参考站同一张卡片) */}
            <ProductKitSettings
              images={images}
              maxImages={imageMax}
              imageLimitError={imageInputError}
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
            />

            {/* 自定义配置 */}
            <ProductKitConfig
              counts={counts}
              onCountChange={(key, value) => setCounts((c) => ({ ...c, [key]: value }))}
            />
          </div>


          {/* 高级设置 + 提交 (sticky 底部) */}
          <ToolSubmitBar
            submitting={generating}
            disabled={!formValid}
            label="立即生成"
            creditLabel={creditLabel ?? undefined}
            settings={
              <ToolSettingsPopover
                open={settingsOpen}
                onToggle={() => setSettingsOpen((v) => !v)}
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
                capabilityId="main_image"
                modelPicker={
                  <ModelPicker
                    capability="main_image"
                    options={{ ratio, resolution }}
                    onQuoteChange={setModelQuoteCredits}
                    onModelChange={setSelectedModel}
                  />
                }
              />
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 功能示例 / 创作结果 ──
          创作结果按批次逐行陈列 (一次生成一行, 原图 + 各变体主图);
          提交后重拉列表拿到整批占位卡, 由 useResultGallery 轮询到全部终态。 */}
      <section className="pd-right-pane">
        <div className="pd-tabs" role="tablist" aria-label="右侧面板">
          <button
            type="button"
            role="tab"
            id="pk-tab-demo"
            aria-selected={rightTab === 'demo'}
            aria-controls="pk-panel-demo"
            className={rightTab === 'demo' ? 'is-active' : ''}
            onClick={() => pickRightTab('demo')}
          >
            功能示例
          </button>
          <button
            type="button"
            role="tab"
            id="pk-tab-results"
            aria-selected={rightTab === 'results'}
            aria-controls="pk-panel-results"
            className={rightTab === 'results' ? 'is-active' : ''}
            onClick={() => pickRightTab('results')}
          >
            创作结果
            {generationCount > 0 && <span className="pd-tab-count">{generationCount}</span>}
          </button>
        </div>

        <div className="pd-right-body">
          {rightTab === 'demo' ? (
            <div role="tabpanel" id="pk-panel-demo" aria-labelledby="pk-tab-demo" className="pd-right-panel">
              <ProductKitExamplePanel />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="pk-panel-results"
              aria-labelledby="pk-tab-results"
              className="pd-right-panel"
            >
              <ProductKitResultList
                items={gallery.items}
                loading={gallery.loading}
                error={gallery.error}
                emptyTitle="效果图预览"
                emptyDesc={resultEmptyDesc}
                emptyChildren={resultEmptyChildren}
                onRefresh={refreshGallery}
                onDeleteRow={deleteRow}
                downloadNamePrefix="main-image"
              />
            </div>
          )}
        </div>
      </section>

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
