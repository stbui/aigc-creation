import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  MAX_IMAGE_MB,
  MAX_IMAGES,
  VARIANT_FIELDS,
  VARIANT_LABELS,
  type PkResult,
} from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  ModelPicker,
  ResultGalleryPane,
  ToolSettingsPopover,
  ToolSubmitBar,
  ToolWorkflowSteps,
} from './components';
import { ProductKitConfig } from './ProductKitConfig';
import { ProductKitDescriptionModal } from './ProductKitDescriptionModal';
import { ProductKitSettings } from './ProductKitSettings';
import { ProductKitTabs } from './ProductKitTabs';
import {
  notifyCreditsChanged,
  useAuth,
  useCreditCost,
  useGenerateError,
  useImageUpload,
  usePollAbort,
  useProject,
  useResultGallery,
  type GalleryItem,
} from './hooks';
import { generateApi, newIdempotencyKey, promptToolsApi, resolveModelId } from './api';
import {
  platformSpec,
  pollToResult,
  taskErrorText,
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
  // 上传 (三重校验 / 素材库回填 / 粘贴) 统一由 useImageUpload 处理
  const { images, uploading, fileInputRef, uploadFiles, removeImage, library, mobile } = useImageUpload({
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
   * 用户重试必须复用同一批幂等键，让后端返回既有任务而不是再扣一次钱。
   * 拿到全部 taskId 后清空，之后的主动“再生成一次”才是新任务。
   */
  const pendingBatchRef = useRef<{ fingerprint: string; keys: string[] } | null>(null);
  /*
   * 不再读取 capability runtime 在此页展示「该能力需要真实模型才能生成，当前暂不可用」。
   * 该提示是运营/配置侧的内部原因，C 端工作台不展示；真正的可用性仍由后端把关
   * （下架走 40005，无线路由 resolveModelId 在提交时如实报错）。
   */
  const [results, setResults] = useState<PkResult[]>([]);
  /** 本次提交的变体清单: 生成期间在结果网格首位画等量占位卡 */
  const [pending, setPending] = useState<Array<{ key: string; label?: string }>>([]);
  const pollSignal = usePollAbort();

  // ── 右侧结果栏 ──
  //
  // 与创意生图页同构: 网格展示本能力**全部**历史产出, 本次出图由
  // gallery.prepend 插到榜首, 用户仍能回看之前的白底图/场景图/卖点图。
  const { token } = useAuth();
  const gallery = useResultGallery({ capability: 'main_image', token, captionOf: variantCaption });
  // 服务端仍有 running/pending 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢
  const generating = submitting || gallery.items.some((item) => !item.url);

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
  const formValid = images.length > 0 && productName.trim().length > 0 && description.trim().length > 0 && totalCount > 0;

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
        message.warning('模型没有返回内容，请重试');
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
      message.error((e as Error).message || '识图失败：文本通道未配置');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── 生成 ──
  const pollTask = useCallback(
    async (taskId: string, variant: string): Promise<PkResult> => ({
      taskId,
      variant,
      ...(await pollToResult(taskId, { signal: pollSignal })),
    }),
    [pollSignal],
  );

  const submit = async () => {
    if (!formValid || generating) return;
    // guest 点击仍应走登录弹窗（generateApi 的 401 → auth:required 契约）
    setSubmitting(true);
    setResults([]);
    /** 已成功创建的任务。即使后续某个请求失败，这些任务也已经扣过费，必须展示。 */
    const taskIds: Array<{ taskId: string; variant: string }> = [];

    const applyResults = (done: PkResult[]) => {
      setResults(done);
      /*
       * 成功的图**直接插到网格首位**, 不回头重拉列表 (与创意生图页同款):
       * 重拉会多一次往返, 占位撤下与新图到位之间出现回弹闪烁。
       * 成功的按任务参数补上变体标签 → 网格里能一眼区分白底图/场景图/卖点图。
       */
      const fresh: GalleryItem[] = done
        .filter((r) => r.status === 'succeeded' && r.url)
        .map((r) => ({
          id: r.taskId,
          url: r.url as string,
          assetId: r.assetId,
          format: r.format,
          width: r.width ?? null,
          height: r.height ?? null,
          createdAt: new Date().toISOString(),
          caption: VARIANT_LABELS[r.variant] ?? r.variant,
        }));
      gallery.prepend(fresh);
      return done.filter((r) => r.status !== 'succeeded').length;
    };

    try {
      const projectId = await ensureProject();
      // 一批变体必须落在同一个模型上，解析一次即可；循环里再解析会让
      // 目录缓存过期的瞬间出现「同一批用了两个模型」
      const logicalModelId = await resolveModelId('main_image');
      // 自定义配置计数 → 每类变体生成 count 张 (与参考站批量出图行为一致)
      const plan: string[] = [];
      for (const v of VARIANT_FIELDS) {
        const n = counts[v.key] ?? 0;
        for (let i = 0; i < n; i++) plan.push(v.key);
      }
      // 占位卡与本次任务数一一对应 (含变体名), 出图后由新图顶替
      setPending(plan.map((v, i) => ({ key: `${v}-${i}`, label: VARIANT_LABELS[v] ?? v })));

      const baseParams = {
        productName: productName.trim(),
        brand: brand.trim(),
        platform,
        language,
        description: description.trim(),
        ratio,
        size: resolution,
      };
      const inputAssetIds = images.map((x) => x.id);

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
      const keys =
        pendingBatchRef.current?.fingerprint === fingerprint
          ? pendingBatchRef.current.keys
          : plan.map(() => newIdempotencyKey());
      pendingBatchRef.current = { fingerprint, keys };

      // 顺序创建任务: 并行创建曾触发 broker IPC EPIPE, 顺序提交更稳
      for (let i = 0; i < plan.length; i += 1) {
        const variant = plan[i];
        const { taskId } = await generateApi.start({
          projectId,
          capability: 'main_image',
          logicalModelId,
          inputAssetIds,
          idempotencyKey: keys[i],
          params: { ...baseParams, variant },
        });
        taskIds.push({ taskId, variant });
      }
      // 全部 taskId 已到手: 后续轮询/网络失败都不需要重放建单请求
      pendingBatchRef.current = null;

      const done = await Promise.all(taskIds.map((t) => pollTask(t.taskId, t.variant)));
      const failed = applyResults(done);
      if (failed > 0) message.error(`${failed} 张生成失败，请重试`);
      else message.success(`已生成 ${done.length} 张商品主图`);
    } catch (e) {
      reportError(e);
      /*
       * 中途建单失败：已创建的任务不回滚（服务端已扣费），这里继续把它们
       * 轮询完并展示出来，避免用户看到“整批失败”却还有幽灵任务占着积分。
       * 幂等键保留在 pendingBatchRef，用户点重试会复用既有任务。
       */
      if (taskIds.length > 0) {
        const done = await Promise.all(taskIds.map((t) => pollTask(t.taskId, t.variant)));
        const failed = applyResults(done);
        message.warning(
          `已创建 ${taskIds.length} 个任务，其中 ${failed} 个未成功；可重试补齐。`,
        );
      }
    } finally {
      setSubmitting(false);
      setPending([]);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  /*
   * 本次提交里失败的任务。results 只装本次提交的结果, 历史产出由 gallery
   * 维护, 两者不混 —— 历史失败不该挂在本次的提示行上。
   */
  const failedResults = results.filter((r) => r.status !== 'succeeded');
  const failedCount = failedResults.length;

  /**
   * 删除一张生成图 —— DELETE /tasks/:id 会连带删掉产出素材与磁盘文件。
   *
   * 与创意生图页同款确认框: 删除不可逆, 且用户此时看到的是缩略图,
   * 未必意识到「作品记录」也一起没了。
   */
  const deleteImage = (item: GalleryItem) => {
    modal.confirm({
      title: '删除这张作品？',
      content: '生成图与本地文件会一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await generateApi.remove(item.id);
          gallery.removeItem(item.id);
          message.success('已删除作品及其生成图');
        } catch (e) {
          message.error((e as Error).message || '删除失败');
        }
      },
    });
  };

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <aside className="pk-input-pane">
        <div className="pk-form-card">
          {/* 业务类型 tab: 参考站仅窄屏显示 (桌面端 display:none 实拍确认) */}
          <ProductKitTabs />

          <div className="pk-form-scroll">
            {/* 上传商品图 + 生成设置 + 商品描述 (参考站同一张卡片) */}
            <ProductKitSettings
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
                  />
                }
              />
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 (本能力全部生成图) ──
          与创意生图页同构的全部产出网格; 本次出图由 gallery.prepend 插到榜首,
          生成中按变体数画占位卡。 */}
      <ResultGalleryPane
        title={generating ? '生成中…' : '全部生成图'}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        notice={
          failedCount > 0 ? (
            <p className="tool-submit-notice tool-submit-notice-error">
              本次有 {failedCount} 张生成失败：{taskErrorText(failedResults[0]?.errorCode)}，可重新生成
            </p>
          ) : null
        }
        pending={submitting ? pending : []}
        emptyTitle="效果图预览"
        emptyDesc={
          token
            ? '提交任务后，生成结果将在此处展示，本页生成过的图都会保留在这里'
            : '登录后，你在这个页面生成过的图都会显示在这里'
        }
        emptyChildren={<ToolWorkflowSteps />}
        onRefresh={() => void gallery.reload()}
        onDelete={deleteImage}
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
