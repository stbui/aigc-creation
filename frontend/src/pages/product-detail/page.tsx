import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Sparkles } from 'lucide-react';

import { MAX_DESC_LEN, MAX_IMAGE_MB, MAX_IMAGES, MAX_NAME_LEN } from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  ModelPicker,
  ToolImageDropzone,
  ToolSettingsPopover,
  ToolSubmitBar,
  ToolWorkflowSteps,
} from './components';
import { DetailExamplePanel } from './DetailExamplePanel';
import { DetailResultList } from './DetailResultList';
import { DetailSectionPicker } from './DetailSectionPicker';
import { FormSelect } from './FormSelect';
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
import { countGenerations, languageOptions, platformDetailSpec, platformOptions, sectionCaption } from './utils';
import { useApp, Modal } from '../../ui';

/**
 * 商品详情图工作台
 *
 * 版面数值来自参考站 computed styles 实拍 (1920×1080):
 *   主区/输入栏/卡片/上传区/生成设置/商品描述与 product-kit 完全一致 (同类 class)
 *   包含模块卡: 白底 radius 16 padding 16; 标题行 400x20 space-between, 计数器 12px #EB5757
 *   模块选择器: 2 列 x 192 gap 16; 选项 192x66, 底 #F2F4F7, radius 8,
 *              padding 8 8 8 16, flex gap 8; 复选框 14x14 accent #625DF5
 *              标题 14px #333 lh22 / 说明 12px #86909C lh20; 上限 10 个 (已选 N/10)
 *   高级设置: 仅"画质"chip (无比例); 提交按钮与 product-kit 同款紫色渐变
 *
 * 接线: 上传 → assets API; 包含模块 → detail_image 任务的 sections 参数
 * (逗号分隔模块键, 后端按每个模块各建一个任务、各出一张图, 按张计费);
 * 画质 → size 参数 (1K/2K/4K; 4K 需要可用的模型通道支持, 否则置灰并说明)。
 *
 * 文件分工: 接口面见 `./api`, 本页状态见 `./hooks`, 常量见 `./constants`,
 * 共享控件见 `./components`, 纯函数与外部工具见 `./utils`,
 * 四个板块组件各自成文件 (`DetailSectionPicker` / `DetailResultList` /
 * `DetailExamplePanel` / `FormSelect`)。分层约定见
 * `docs/frontend-module-conventions.md`。
 */

export function ProductDetailPage() {
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
  // 包含模块: 上限、顺序归一化与默认勾选都在 useSectionSelection + DetailSectionPicker
  const { sections, toggle: toggleSection } = useSectionSelection();
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
        ? '提交任务后，每个模块都会生成一张图，按次陈列在这里'
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

  /** 放大编辑弹窗的开 / 关 (两处回调共用同一引用) */
  const closeExpand = useCallback(() => setExpandOpen(false), []);
  const openExpand = useCallback(() => setExpandOpen(true), []);
  /*
   * 高级设置的开合。必须是稳定引用: ToolSettingsPopover 的「点外部 / Esc 收起」
   * 监听器以该回调为依赖, 每次按键都换新引用会让监听器反复解绑重绑。
   */
  const toggleSettings = useCallback(() => setSettingsOpen((v) => !v), []);

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <aside className="pk-input-pane">
        <div className="pk-form-card">
          {/* 业务类型 tab: 参考站仅窄屏显示 (桌面端 display:none 实拍确认) */}
          <div className="pk-editor-tabs" role="tablist" aria-label="业务类型">
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/product-kit')}>
              商品主图
            </button>
            <button type="button" role="tab" aria-selected className="pk-editor-tab pk-editor-tab-active">
              商品详情
            </button>
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/viral-clone')}>
              爆款复刻
            </button>
          </div>

          <div className="pk-form-scroll">
            {/* 上传商品图 + 生成设置 + 商品描述 (参考站同一张卡片) */}
            <section className="pk-config-card">
              <ToolImageDropzone
                title="上传商品图"
                images={images}
                max={MAX_IMAGES}
                maxMb={MAX_IMAGE_MB}
                uploading={uploading}
                fileInputRef={fileInputRef}
                onFiles={(f) => void uploadFiles(f)}
                onRemove={removeImage}
                onOpenLibrary={openLibrary}
                onOpenMobile={mobile.openMobile}
                noun="商品图片"
              />

              <div className="pk-section">
                <strong className="pk-section-title">
                  <i className="pk-required-mark">*</i>生成设置
                </strong>
                <div className="pk-form-grid">
                  <label className="pk-field">
                    <span className="pk-field-label">
                      <i className="pk-required-mark">*</i>商品名称
                    </span>
                    <input
                      value={productName}
                      maxLength={MAX_NAME_LEN}
                      placeholder="* 请输入商品名称"
                      onChange={(e) => setProductName(e.target.value)}
                    />
                  </label>
                  <label className="pk-field">
                    <span className="pk-field-label">品牌（选填）</span>
                    <input
                      value={brand}
                      maxLength={MAX_NAME_LEN}
                      placeholder="请输入品牌（选填）"
                      onChange={(e) => setBrand(e.target.value)}
                    />
                  </label>
                  <FormSelect label="平台" value={platform} options={platformOptions()} onChange={changePlatform} />
                  <FormSelect label="语言" value={language} options={languageOptions()} onChange={setLanguage} />
                </div>
              </div>

              <div className="pk-section">
                <div className="pk-field-label-row">
                  <span className="pk-section-title">
                    <i className="pk-required-mark">*</i>商品描述
                  </span>
                  <div className="pk-desc-actions">
                    <button
                      type="button"
                      className="pk-ai-btn"
                      disabled={analyzing}
                      onClick={() => void runAiAnalyze()}
                    >
                      <Sparkles size={12} />
                      <span>{analyzing ? '分析中…' : 'AI分析'}</span>
                    </button>
                  </div>
                </div>
                <div className="pk-desc-editor">
                  <textarea
                    rows={3}
                    maxLength={MAX_DESC_LEN}
                    value={description}
                    placeholder="* 请输入商品描述"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pk-desc-expand"
                    aria-label="放大编辑商品描述"
                    title="放大编辑"
                    onClick={openExpand}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </section>

            <DetailSectionPicker selected={sections} onToggle={toggleSection} />
          </div>

          {/* 高级设置 + 提交 (sticky 底部) */}
          <ToolSubmitBar
            submitting={generating}
            disabled={!formValid || (Boolean(token) && capabilityBlocked)}
            label="立即生成"
            creditLabel={creditLabel ?? undefined}
            hint={
              capabilityBlocked && token ? (
                <span className="tool-submit-notice tool-submit-notice-error">{capabilityReason}</span>
              ) : undefined
            }
            settings={
              <ToolSettingsPopover
                open={settingsOpen}
                onToggle={toggleSettings}
                resolution={resolution}
                onResolutionChange={(v) => {
                  setResolutionTouched(true);
                  setResolution(v);
                }}
                capabilityId={DETAIL_CAPABILITY}
                showRatio={false}
                modelPicker={
                  <ModelPicker
                    capability={DETAIL_CAPABILITY}
                    options={{ resolution }}
                    onQuoteChange={setModelQuoteCredits}
                  />
                }
              />
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 功能示例 / 创作结果 ──
          创作结果按批次逐行陈列 (一次生成一行, 原图 + 各模块图);
          提交后重拉列表拿到整批占位卡, 由 useResultGallery 轮询到全部到终态。 */}
      <section className="pd-right-pane">
        <div className="pd-tabs" role="tablist" aria-label="右侧面板">
          <button
            type="button"
            role="tab"
            id="pd-tab-demo"
            aria-selected={rightTab === 'demo'}
            aria-controls="pd-panel-demo"
            className={rightTab === 'demo' ? 'is-active' : ''}
            onClick={() => pickRightTab('demo')}
          >
            功能示例
          </button>
          <button
            type="button"
            role="tab"
            id="pd-tab-results"
            aria-selected={rightTab === 'results'}
            aria-controls="pd-panel-results"
            className={rightTab === 'results' ? 'is-active' : ''}
            onClick={() => pickRightTab('results')}
          >
            创作结果
            {generationCount > 0 && <span className="pd-tab-count">{generationCount}</span>}
          </button>
        </div>

        <div className="pd-right-body">
          {rightTab === 'demo' ? (
            <div role="tabpanel" id="pd-panel-demo" aria-labelledby="pd-tab-demo" className="pd-right-panel">
              <DetailExamplePanel />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="pd-panel-results"
              aria-labelledby="pd-tab-results"
              className="pd-right-panel"
            >
              <DetailResultList
                items={gallery.items}
                loading={gallery.loading}
                error={gallery.error}
                emptyTitle="效果图预览"
                emptyDesc={resultEmptyDesc}
                emptyChildren={resultEmptyChildren}
                onRefresh={refreshGallery}
                onDeleteRow={deleteRow}
                downloadNamePrefix="product-detail"
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
      <Modal
        open={expandOpen}
        title="编辑商品描述"
        okText="确定"
        cancelText="取消"
        onOk={closeExpand}
        onCancel={closeExpand}
      >
        <textarea
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
