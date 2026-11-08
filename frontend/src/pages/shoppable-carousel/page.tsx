import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CAPABILITY_ID,
  DEFAULT_COUNT,
  DEFAULT_LANGUAGE,
  DEFAULT_MARKET,
  DEFAULT_PLATFORM,
  MAX_COUNT,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  MIN_COUNT,
} from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  ModelPicker,
  ToolSubmitBar,
  ToolSettingsPopover,
} from './components';
import { ShoppableCarouselConfig } from './ShoppableCarouselConfig';
import { ShoppableCarouselHistory } from './ShoppableCarouselHistory';
import { ShoppableCarouselResultList } from './ShoppableCarouselResultList';
import { ShoppableCarouselStepper } from './ShoppableCarouselStepper';
import { TemplateGrid } from './TemplateGrid';
import {
  notifyCreditsChanged,
  useAuth,
  useCapabilityRuntime,
  useCreditCost,
  useGenerateError,
  useImageUpload,
  useProject,
  useResultGallery,
  type GalleryItem,
} from './hooks';
import { ApiError, generateApi, newIdempotencyKey, promptToolsApi, resolveModelId, shoppableCarouselApi } from './api';
import { clampCount, filterTemplatesByCategory } from './utils';
import { Modal, useApp } from '../../ui';
import type { ShoppableCarouselTemplate } from '../../types/api';

/**
 * AI 带货图文工作台
 *
 * 页面结构对齐参考站实拍（`docs/shoppable-carousel-design.md`）：
 *   左配置栏（上传 / 生成设置 / 卖点文案 / 生成模式 / 附加功能 / 张数）
 *   + 右侧模板区（分类 tab + 模板网格），右栏另开「创作结果」页签承载历史记录。
 *
 * 生成链路与站内其它能力同源：一次提交由后端 `outputPlan` 拆成 N 个任务，
 * 每张各计一次价、共享 batchId；页面只负责收集输入与展示。
 */

/** 分类 tab 的「全部」项（纯前端筛选态，不来自后端） */
const ALL_CATEGORY = '';

/**
 * `POST /generate` 的失败是否「结果不明」。
 *
 * 一次提交只发一个请求，服务端在**同一事务**里建任务 + 建账 + 预留：
 *   · 4xx 是扣费前的确定性拒绝（参数 / 权益 / 余额），不可能留下任务；
 *   · 5xx 与 fetch 网络中断时，请求可能已经到达服务端并落库，
 *     只能提示用户先核对生成记录。
 */
function isUncertainSubmitError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}

export function ShoppableCarouselPage() {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token } = useAuth();

  // ── 模板清单（来自后端，前端不存副本） ──
  const [templates, setTemplates] = useState<ShoppableCarouselTemplate[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  /**
   * 生成张数区间。
   *
   * 本地常量只作首屏兜底：接口返回后以服务端 `countRange` 为准，
   * 避免后端调整区间时前端仍按旧值收敛/计价。
   */
  const [countRange, setCountRange] = useState({ min: MIN_COUNT, max: MAX_COUNT });
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(ALL_CATEGORY);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const result = await shoppableCarouselApi.templates();
      setTemplates(result.templates);
      setCategories(result.categories);
      const min = Math.trunc(Number(result.countRange?.min));
      const max = Math.trunc(Number(result.countRange?.max));
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && min <= max) {
        setCountRange({ min, max });
      }
    } catch (e) {
      setTemplatesError((e as Error).message || '模板清单加载失败');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // ── 上传 ──
  const { images, uploading, fileInputRef, uploadFiles, removeImage, clearImages, library, mobile } = useImageUpload({
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
  const [platform, setPlatform] = useState(DEFAULT_PLATFORM);
  const [market, setMarket] = useState(DEFAULT_MARKET);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [ratio, setRatio] = useState('3:4');
  const [resolution, setResolution] = useState('1k');
  const [sellingPoints, setSellingPoints] = useState('');
  const [mode, setMode] = useState<'ai' | 'template'>('ai');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [noText, setNoText] = useState(false);
  const [socialCaption, setSocialCaption] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 「全部记录」抽屉 —— 底部历史条只放最近几次, 完整批次列表在这里 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);

  /**
   * 最近一次「结果未确认」的提交。
   *
   * 一次提交只发一个请求；网络中断或 5xx 时服务端可能已建单。
   * 用户重试必须复用同一幂等键，让后端返回既有任务而不是再扣一次钱。
   * 成功拿到响应后清空。
   */
  const pendingSubmitRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  // ── 右侧结果栏 ──
  const gallery = useResultGallery({
    capability: CAPABILITY_ID,
    token,
    includeFailed: true,
  });
  const generating = useMemo(
    () => submitting || gallery.items.some((item) => item.status === 'queued' || item.status === 'running'),
    [submitting, gallery.items],
  );
  const refreshGallery = useCallback(() => {
    void gallery.reload();
  }, [gallery.reload]);

  // ── 能力运行时（不可用时禁用提交并给出原因） ──
  const { runtime, blocked, reason } = useCapabilityRuntime(CAPABILITY_ID);

  // ── 价签：按本次要出几张算总价 ──
  const unitCreditCost = useCreditCost(CAPABILITY_ID);
  const creditLabel = useMemo(() => {
    const unit = modelQuoteCredits ?? unitCreditCost;
    if (unit == null) return null;
    if (unit === 0) return '免费';
    const total = unit * Math.max(count, 1);
    return modelQuoteCredits == null
      ? `本次消耗 ${total} 积分`
      : `本次约 ${total} 积分（按所选模型）`;
  }, [unitCreditCost, modelQuoteCredits, count]);

  /** 张数收敛到服务端区间（首屏未拿到模板清单时用本地兜底值） */
  const onCountChange = useCallback(
    (value: number) => {
      setCount(clampCount(value, countRange.min, countRange.max));
    },
    [countRange],
  );

  // 服务端区间与本地默认不一致时，把当前张数收进新区间
  useEffect(() => {
    setCount((prev) => clampCount(prev, countRange.min, countRange.max));
  }, [countRange]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  /**
   * 模板生成模式必须先选模板 —— 与后端 `validateCapabilityParams`
   * 的同一道校验对齐（服务端也会拒，这里提前给出提示）。
   */
  const formValid =
    images.length > 0 &&
    (mode === 'ai' || Boolean(selectedTemplateId)) &&
    count >= countRange.min &&
    count <= countRange.max;

  /**
   * 选模板 = 切到模板生成模式。
   *
   * 参考站实测：点模板卡的「选用」后，生成模式自动切到「模板生成」。
   */
  const selectTemplate = useCallback((template: ShoppableCarouselTemplate) => {
    setSelectedTemplateId(template.id);
    setMode('template');
  }, []);

  /**
   * 「换一个」：随机换一个模板，并同步右侧选中态。
   *
   * 参考站实拍：点「换一个」后，左栏回显与右栏选中卡同时换成另一个模板，
   * 分类保持在「全部模板」不动。
   */
  const shuffleTemplate = useCallback(() => {
    const pool = templates.filter((t) => t.id !== selectedTemplateId);
    if (pool.length === 0) return;
    const next = pool[Math.floor(Math.random() * pool.length)];
    setSelectedTemplateId(next.id);
    setMode('template');
  }, [templates, selectedTemplateId]);

  /**
   * AI 帮写：**基于图片**生成卖点文案（图文互转），不是润色已有文本。
   *
   * 参考站实拍：空图时点「AI 帮写」提示「请先上传至少一张图片」——
   * 说明它读的是图片内容。故走 `promptToolsApi.imageToPrompt`，
   * 与商品主图页的「AI 分析」同源。
   *
   * 失败语义: 文本通道没配时后端返回 502，如实把原因抛给用户；
   * 绝不退回「按已有文案编一段」—— 那会让用户以为模型看过图。
   */
  const runAiWrite = async () => {
    if (images.length === 0) {
      message.warning('请先上传至少一张图片');
      return;
    }
    const first = images[0];
    if (!first?.id) {
      message.warning('首张图缺少素材 id，请重新上传后再试');
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
      // 已填过内容时不静默覆盖, 先问一句
      if (sellingPoints.trim()) {
        modal.confirm({
          title: '替换商品卖点？',
          content: 'AI 帮写会覆盖当前已填写的卖点与生成要求。',
          okText: '替换',
          cancelText: '取消',
          onOk: () => setSellingPoints(content),
        });
        return;
      }
      setSellingPoints(content);
      message.success('已按商品图生成卖点文案，可继续编辑');
    } catch (e) {
      message.error((e as Error).message || '文案生成暂时不可用，请稍后再试');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── 生成 ──
  const submit = async () => {
    if (!formValid || generating) return;
    setSubmitting(true);
    let batchStarted = false;

    try {
      const projectId = await ensureProject();
      const logicalModelId = await resolveModelId(CAPABILITY_ID);
      const shotCount = clampCount(count, countRange.min, countRange.max);

      const baseParams = {
        templateId: mode === 'template' ? (selectedTemplateId ?? '') : '',
        sellingPoints: sellingPoints.trim(),
        platform,
        market,
        language,
        ratio,
        size: resolution,
        count: shotCount,
        mode,
        noText,
        socialCaption,
      };
      const inputAssetIds = images.map((x) => x.id);

      /*
       * 幂等键按「本次输入指纹」复用：结果未确认时用户重试会拿到同一个 key，
       * 服务端返回已创建的任务而不是再扣一次钱。
       */
      const fingerprint = JSON.stringify({
        capability: CAPABILITY_ID,
        projectId,
        logicalModelId,
        inputAssetIds,
        baseParams,
      });
      const previous =
        pendingSubmitRef.current?.fingerprint === fingerprint ? pendingSubmitRef.current : null;
      const idempotencyKey = previous?.idempotencyKey ?? newIdempotencyKey();
      pendingSubmitRef.current = { fingerprint, idempotencyKey };
      batchStarted = true;

      /*
       * 只建一个任务：后端能力声明了 `outputPlan`（按张数展开），
       * 准入层会拆成 N 个子任务并各自计费。若前端再按张数建 N 次，
       * 就会变成 N × N 个任务（资损）。
       */
      await generateApi.start({
        projectId,
        capability: CAPABILITY_ID,
        logicalModelId,
        inputAssetIds,
        idempotencyKey,
        params: baseParams,
      });

      await gallery.reload();
      pendingSubmitRef.current = null;
      message.success(`已提交 ${shotCount} 张带货图文，生成完成后自动更新`);
    } catch (e) {
      reportError(e);
      if (batchStarted) {
        await gallery.reload();
        /*
         * 4xx 是扣费前拦截，提示用户改输入即可；只有网络中断 / 5xx
         * 才可能「已经建单但没拿到响应」，此时重试会复用幂等键。
         */
        if (isUncertainSubmitError(e)) {
          message.warning('提交结果未确认，请先查看生成记录；重新提交不会重复扣费');
        }
      }
    } finally {
      setSubmitting(false);
      notifyCreditsChanged();
    }
  };

  /**
   * 删除一次生成 —— 服务端把一次提交拆成「父任务 + 子任务」，
   * 删除父任务会级联删掉整批（`generate.service.ts` 的 `removeTask`）。
   * 因此只删 `batchIndex === 1` 的父任务，不再逐张删除 —— 逐张删时
   * 父任务已把整批删掉，后续子任务 DELETE 全部 403，页面会误报
   * 「已删除 1 张，其余删除失败」。
   *
   * 早期「逐张建单」的残批没有父子关系，父任务删除后再逐张兜底。
   */
  const deleteRow = useCallback(
    (items: GalleryItem[]) => {
      if (items.length === 0) return;
      const parent = items.find((item) => Number(item.params?.batchIndex) === 1) ?? items[0];
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
            await gallery.reload();
            return;
          }
          // 有父子关系时后端已级联删完整批；没有时再逐张兜底
          const hasChildren = items.some((item) => item.parentTaskId === parent.id);
          if (!hasChildren) {
            await Promise.allSettled(
              items
                .filter((item) => item.id !== parent.id)
                .map((item) => generateApi.remove(item.id)),
            );
          }
          for (const item of items) gallery.removeItem(item.id);
          message.success('已删除这次生成的全部图片');
        },
      });
    },
    [modal, message, gallery.removeItem, gallery.reload],
  );

  /** 新建任务: 清空表单（含已上传图片）回到空态 */
  const resetTask = useCallback(() => {
    clearImages();
    setSellingPoints('');
    setSelectedTemplateId(null);
    setMode('ai');
    setCount(DEFAULT_COUNT);
    setNoText(false);
    setSocialCaption(true);
    message.success('已新建任务，请上传商品图片');
  }, [clearImages, message]);

  const visibleTemplates = useMemo(
    () => filterTemplatesByCategory(templates, categoryId),
    [templates, categoryId],
  );

  return (
    <div className="sc-workspace">
      <div className="sc-body">
        {/* ── 左: 配置栏 ── */}
        <aside className="sc-input-pane">
          <div className="sc-form-card">
            <div className="sc-form-scroll">
            <ShoppableCarouselConfig
              images={images}
              uploading={uploading}
              fileInputRef={fileInputRef}
              onFiles={(f) => void uploadFiles(f)}
              onRemove={removeImage}
              onOpenLibrary={openLibrary}
              onOpenMobile={mobile.openMobile}
              platform={platform}
              onPlatformChange={setPlatform}
              market={market}
              onMarketChange={setMarket}
              language={language}
              onLanguageChange={setLanguage}
              ratio={ratio}
              onRatioChange={setRatio}
              sellingPoints={sellingPoints}
              onSellingPointsChange={setSellingPoints}
              analyzing={analyzing}
              onAnalyze={() => void runAiWrite()}
              mode={mode}
              onModeChange={setMode}
              selectedTemplate={selectedTemplate}
              onShuffleTemplate={shuffleTemplate}
              noText={noText}
              onNoTextChange={setNoText}
              socialCaption={socialCaption}
              onSocialCaptionChange={setSocialCaption}
            />
          </div>

          {/* 固定底栏: 张数步进器 + 高级设置 + 生成按钮（参考站 sidebarFooter, 415×125） */}
          <div className="sc-form-footer">
            {/* 参考站底栏只有一行「张数 + 生成按钮」(415×125)。
                本站的「高级设置」与张数并排放在同一行, 不再单独占一行 ——
                多一行会把底栏撑到 169, 与参考站的 125 明显不符。 */}
            <div className="sc-footer-row">
              <ShoppableCarouselStepper
                count={count}
                min={countRange.min}
                max={countRange.max}
                onCountChange={onCountChange}
              />
              <ToolSettingsPopover
                open={settingsOpen}
                onToggle={() => setSettingsOpen((v) => !v)}
                ratio={ratio}
                onRatioChange={setRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
                capabilityId={CAPABILITY_ID}
                showRatio={false}
                modelPicker={
                  <ModelPicker
                    capability={CAPABILITY_ID}
                    options={{ ratio, resolution }}
                    onQuoteChange={setModelQuoteCredits}
                  />
                }
              />
            </div>
            <ToolSubmitBar
              submitting={generating}
              disabled={!formValid || blocked}
              label="生成带货图文"
              /*
               * 登录墙只在**通道可用**时挂。
               *
               * 通道不可用时挂 guestLabel 会让按钮写成「登录后生成带货图文」——
               * 登录也解决不了没有模型线路的问题, 那是在骗用户。
               * 此时保持真实文案, 由 hint 原样给出 runtime 的原因。
               */
              guestLabel={blocked ? undefined : '登录后生成带货图文'}
              creditLabel={creditLabel ?? undefined}
              hint={
                blocked
                  ? (reason ?? undefined)
                  : mode === 'template' && !selectedTemplateId
                    ? '请先在右侧选择一个模板'
                    : undefined
              }
              onSubmit={() => void submit()}
            />
          </div>
          </div>
        </aside>

        {/* ── 右: 模板展示（常驻）+ 底部历史记录 ── */}
        <section className="sc-showcase">
          <nav className="sc-categories" aria-label="模板分类">
            <button
              type="button"
              aria-pressed={categoryId === ALL_CATEGORY}
              className={`sc-category${categoryId === ALL_CATEGORY ? ' is-active' : ''}`}
              onClick={() => setCategoryId(ALL_CATEGORY)}
            >
              全部模板
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={categoryId === category.id}
                className={`sc-category${categoryId === category.id ? ' is-active' : ''}`}
                onClick={() => setCategoryId(category.id)}
              >
                {category.label}
              </button>
            ))}
          </nav>

          <div className="sc-template-scroll">
            <TemplateGrid
              templates={visibleTemplates}
              selectedId={selectedTemplateId}
              onSelect={selectTemplate}
              error={templatesError}
              loading={templatesLoading}
            />
          </div>

          {/* 底部历史记录: 常驻, 不与模板区互斥 */}
          <ShoppableCarouselHistory
            items={gallery.items}
            loading={gallery.loading}
            error={gallery.error}
            onRefresh={refreshGallery}
            onOpenAll={() => setHistoryOpen(true)}
          />
        </section>
      </div>

      {/* 素材库选择弹窗（真实数据） */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={MAX_IMAGES}
      />

      {/* 手机上传弹窗（二维码方案） */}
      <MobileUploadModal open={mobile.open} onReceived={mobile.addAssets} onCancel={mobile.closeMobile} />

      {/* 全部记录抽屉：底部历史条只放最近几次，完整批次列表（含删除 / 下载）在这里 */}
      <Modal
        open={historyOpen}
        title="全部生成记录"
        width={960}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <ShoppableCarouselResultList
          items={gallery.items}
          loading={gallery.loading}
          error={gallery.error}
          emptyTitle="还没有生成记录"
          emptyDesc={
            token
              ? '提交任务后，这次生成的带货图文会按批次陈列在这里'
              : '登录后，你在这个页面生成过的图文都会显示在这里'
          }
          onDeleteRow={deleteRow}
        />
      </Modal>
    </div>
  );
}
