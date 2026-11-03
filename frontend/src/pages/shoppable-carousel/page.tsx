import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CAPABILITY_ID,
  DEFAULT_COUNT,
  MAX_COUNT,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  MIN_COUNT,
  PLATFORM_OPTIONS,
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
  useRightTab,
  type GalleryItem,
} from './hooks';
import { generateApi, newIdempotencyKey, promptToolsApi, resolveModelId, shoppableCarouselApi } from './api';
import { clampCount, countGenerations, filterTemplatesByCategory } from './utils';
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

export function ShoppableCarouselPage() {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token } = useAuth();

  // ── 模板清单（来自后端，前端不存副本） ──
  const [templates, setTemplates] = useState<ShoppableCarouselTemplate[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
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
  const [platform, setPlatform] = useState(PLATFORM_OPTIONS[0].value);
  const [market, setMarket] = useState('us');
  const [language, setLanguage] = useState('en');
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
   * 最近一次「尚未拿到全部 taskId」的提交。
   *
   * 顺序建单时若第 k 个请求网络失败，前 k-1 个任务已在服务端创建；
   * 用户重试必须复用同一批幂等键与 batchId，让后端返回既有任务而不是
   * 再扣一次钱。拿到全部 taskId 后清空。
   */
  const pendingBatchRef = useRef<{ fingerprint: string; keys: string[]; batchId: string } | null>(null);

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
  const generationCount = useMemo(() => countGenerations(gallery.items), [gallery.items]);

  const { rightTab, pick: pickRightTab, showResults } = useRightTab();
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

  /** 张数收敛到 6–10（前后端同样收敛, 见 constants.ts） */
  const onCountChange = useCallback((value: number) => {
    setCount(clampCount(value, MIN_COUNT, MAX_COUNT));
  }, []);

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
    count >= MIN_COUNT &&
    count <= MAX_COUNT;

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
    showResults();

    try {
      const projectId = await ensureProject();
      const logicalModelId = await resolveModelId(CAPABILITY_ID);
      const shotCount = clampCount(count, MIN_COUNT, MAX_COUNT);

      const baseParams = {
        templateId: mode === 'template' ? (selectedTemplateId ?? '') : '',
        templateName: mode === 'template' ? (selectedTemplate?.name ?? '') : '',
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
       * 幂等键按「本次输入指纹」复用：某次建单请求在网络层失败后，用户重试
       * 会拿到同一个 key，服务端返回已创建的任务而不是再扣一次钱。
       */
      const fingerprint = JSON.stringify({
        capability: CAPABILITY_ID,
        projectId,
        logicalModelId,
        inputAssetIds,
        baseParams,
      });
      const previous = pendingBatchRef.current?.fingerprint === fingerprint ? pendingBatchRef.current : null;
      const batchId = previous?.batchId ?? newIdempotencyKey();
      const keys = previous?.keys ?? Array.from({ length: shotCount }, () => newIdempotencyKey());
      pendingBatchRef.current = { fingerprint, keys, batchId };
      batchStarted = true;

      /*
       * 顺序创建任务: 并行创建曾触发 broker IPC EPIPE, 顺序提交更稳。
       *
       * 后端能力声明了 `outputPlan`（按张数展开），因此这里**只建一个任务** ——
       * 准入层会按 outputPlan 拆成 N 个子任务并各自计费。若前端再按张数建 N 次,
       * 就会变成 N × N 个任务（资损）。
       */
      await generateApi.start({
        projectId,
        capability: CAPABILITY_ID,
        logicalModelId,
        inputAssetIds,
        idempotencyKey: keys[0],
        params: {
          ...baseParams,
          batchId,
          batchIndex: 1,
          batchSize: shotCount,
        },
      });

      await gallery.reload();
      pendingBatchRef.current = null;
      message.success(`已提交 ${shotCount} 张带货图文，生成完成后自动更新`);
    } catch (e) {
      reportError(e);
      if (batchStarted) {
        await gallery.reload();
        message.warning('部分带货图文可能已提交，请查看生成记录；重新提交会继续补齐本批');
      }
    } finally {
      setSubmitting(false);
      notifyCreditsChanged();
    }
  };

  /**
   * 删除一次生成 —— 批次由多个独立任务组成, 没有 parentTaskId,
   * 因此必须逐张删除；成功的本地摘除, 失败的保留并提示刷新重试。
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

  /** 新建任务: 清空表单回到空态（参考站的「新建任务」按钮实测无行为，本站给它真实语义） */
  const resetTask = useCallback(() => {
    setSellingPoints('');
    setSelectedTemplateId(null);
    setMode('ai');
    setCount(DEFAULT_COUNT);
    setNoText(false);
    setSocialCaption(true);
    message.success('已新建任务，请上传商品图片');
  }, [message]);

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
              <ShoppableCarouselStepper count={count} onCountChange={onCountChange} />
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
          onRefresh={refreshGallery}
          onDeleteRow={deleteRow}
        />
      </Modal>
    </div>
  );
}
