import { useCallback, useMemo, useState } from 'react';
import { App, Input, Modal, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minus, Plus, Sparkles } from 'lucide-react';
import { generateApi, promptToolsApi } from '../lib/api';
import { MAX_IMAGE_MB, taskErrorText } from '../lib/constants';
import { languageOptions, platformOptions } from '../lib/optionSets';

import { ToolSubmitBar } from '../components/ToolSubmitBar';
import { ToolImageDropzone } from '../components/ToolImageDropzone';
import { ToolSettingsPopover } from '../components/ToolSettingsPopover';
import { AssetLibraryModal } from '../components/AssetLibraryModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { ToolWorkflowSteps } from '../components/ToolEmptyState';
import { ResultGalleryPane } from '../components/ResultGalleryPane';
import { useImageUpload } from '../hooks/useImageUpload';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { useCapabilityRuntime } from '../hooks/useCapabilityRuntime';
import { useGenerateError } from '../hooks/useGenerateError';
import { useResultGallery, type GalleryItem } from '../hooks/useResultGallery';
import { useAuth } from '../context/AuthContext';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { pollToResult } from '../lib/poll';
import type { TaskStatus } from '../types/api';

/**
 * 商品主图工作台 —— 1:1 复刻参考站 https://ijihua.cn/product-kit。
 *
 * 版面数值全部来自参考站 computed styles 实拍 (1920×1080):
 *   主区 grid gap 16, padding 24px 24px 24px 16px; 左输入栏 432px, 右结果栏 flex
 *   卡片白底 radius 16 padding 16, 区块 gap 24; 标题 14px/700 #333, 必填星号 14px #EB5757
 *   上传区 400×160 虚线 #E5E7EF / 底 #F2F4F7 / radius 8; 主文案 14px #1D2129, 副文案 12px #86909C
 *   表单项 196×32 (2 列 gap 8), 输入框 radius 4 / 边 #E5E7EF / padding 5px 12px / 14px #333
 *   商品描述 textarea 400×80, padding 5px 36px 5px 12px; 放大按钮 28×28 绝对定位 top/right 8
 *   自定义配置 2 列 × 192 (gap 16), 标签 14px #667085, 步进器 120×32 (32/56/32)
 *   高级设置条 400×34 radius 7 padding 0 10px; 标签 12px/600 #454C59; chip 11px #48505E
 *   主按钮 400×40, linear-gradient(90deg,#8064F6,#5546D8), radius 8, 13px/800 白字
 *   结果空态: 白底 radius 16 居中, 插画 160×160 + 标题 14px/700 + 描述 12px #86909C
 *
 * 每个控件都接到真实后端: 上传 → assets API; 自定义配置计数 → 按变体展开为
 * 多次 main_image 生成任务; 平台/比例/画质/名称/品牌/语言/描述 → 任务参数。
 * AI分析 走文本通道的「图片转提示词」(promptToolsApi.imageToPrompt), 由模型识别首图;
 * 文本通道未配置时后端 502, 界面如实报错, 不用文件名冒充识别结果。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_IMAGES = 5;
const MAX_NAME_LEN = 100; // 参考站 input maxlength
const MAX_DESC_LEN = 5000; // 参考站 textarea maxlength

/** 自定义配置四类计数 → 主图变体 (与后端 registry MAIN_IMAGE_VARIANTS 对齐) */
const VARIANT_FIELDS = [
  { key: 'white_background', label: '白底图', default: 1 },
  { key: 'scene', label: '场景图', default: 1 },
  { key: 'selling_point', label: '卖点图', default: 1 },
  { key: 'other', label: '其他图', default: 0 },
] as const;

const VARIANT_LABELS: Record<string, string> = {
  white_background: '白底图',
  scene: '场景图',
  selling_point: '卖点图',
  other: '其他图',
};

interface PkResult {
  taskId: string;
  variant: string;
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}

/**
 * 任务参数里的变体 → 中文标签。
 * 后端定义在 definitions/param-options.ts 的 MAIN_IMAGE_VARIANTS, 这里的
 * VARIANT_LABELS 与之一一对应; 认不出的变体原样显示, 不吞掉信息。
 */
function variantCaption(params: Record<string, unknown>): string | undefined {
  const v = params?.variant;
  return typeof v === 'string' ? (VARIANT_LABELS[v] ?? v) : undefined;
}

export function ProductKitPage() {
  const { message, modal } = App.useApp();
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** AI 分析进行中 (按钮禁用 + 文案切换, 防止连点时重复请求文本通道) */
  const [analyzing, setAnalyzing] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  // 实时价来自能力清单（后台可调价），按钮文案不能再写死「免费生图」
  const creditLabel = useCreditLabel('main_image');
  const { blocked: capabilityBlocked, reason: capabilityReason } = useCapabilityRuntime('main_image');
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
  const formValid = images.length > 0 && productName.trim().length > 0 && description.trim().length > 0 && totalCount > 0;

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
    // guest 点击仍应走登录弹窗（generateApi 的 401 → auth:required 契约）；
    // 已登录时才把「能力不可用」作为硬拦截。
    if (token && capabilityBlocked) {
      message.warning(capabilityReason || '该能力当前不可提交');
      return;
    }
    setSubmitting(true);
    setResults([]);
    try {
      const projectId = await ensureProject();
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

      // 顺序创建任务: 并行创建曾触发 broker IPC EPIPE, 顺序提交更稳
      const taskIds: Array<{ taskId: string; variant: string }> = [];
      for (const variant of plan) {
        const { taskId } = await generateApi.start({
          projectId,
          capability: 'main_image',
          inputAssetIds: images.map((x) => x.id),
          params: { ...baseParams, variant },
        });
        taskIds.push({ taskId, variant });
      }

      const done = await Promise.all(taskIds.map((t) => pollTask(t.taskId, t.variant)));
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
          width: r.width ?? null,
          height: r.height ?? null,
          createdAt: new Date().toISOString(),
          caption: VARIANT_LABELS[r.variant] ?? r.variant,
        }));
      gallery.prepend(fresh);
      const failed = done.filter((r) => r.status !== 'succeeded').length;
      if (failed > 0) message.error(`${failed} 张生成失败，请重试`);
      else message.success(`已生成 ${done.length} 张商品主图`);
    } catch (e) {
      reportError(e);
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
          <div className="pk-editor-tabs" role="tablist" aria-label="业务类型">
            <button type="button" role="tab" aria-selected className="pk-editor-tab pk-editor-tab-active">
              商品主图
            </button>
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/product-detail')}>
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
                    <Input
                      value={productName}
                      maxLength={MAX_NAME_LEN}
                      placeholder="* 请输入商品名称"
                      onChange={(e) => setProductName(e.target.value)}
                    />
                  </label>
                  <label className="pk-field">
                    <span className="pk-field-label">品牌（选填）</span>
                    <Input
                      value={brand}
                      maxLength={MAX_NAME_LEN}
                      placeholder="请输入品牌（选填）"
                      onChange={(e) => setBrand(e.target.value)}
                    />
                  </label>
                  {/* Select 不用 <label> 包裹: label 会把点击转发给内部 input,
                      已知会让下拉"打开即关闭"; 无障碍名走 aria-label */}
                  <div className="pk-field">
                    <span className="pk-field-label">平台</span>
                    <Select
                      value={platform}
                      onChange={setPlatform}
                      options={platformOptions().map((o) => ({ value: o.value, label: o.label }))}
                      aria-label="平台"
                    />
                  </div>
                  <div className="pk-field">
                    <span className="pk-field-label">语言</span>
                    <Select
                      value={language}
                      onChange={setLanguage}
                      options={languageOptions().map((o) => ({ value: o.value, label: o.label }))}
                      aria-label="语言"
                    />
                  </div>
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
                    onClick={() => setExpandOpen(true)}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </section>

            {/* 自定义配置 */}
            <section className="pk-config-card">
              <div className="pk-section">
                <strong className="pk-section-title">自定义配置</strong>
                <div className="pk-count-grid">
                  {VARIANT_FIELDS.map((v) => (
                    <label key={v.key} className="pk-count-field">
                      <span className="pk-count-label">{v.label}</span>
                      <div className="pk-number-control">
                        <button
                          type="button"
                          aria-label={`减少${v.label}`}
                          onClick={() => setCounts((c) => ({ ...c, [v.key]: Math.max(0, (c[v.key] ?? 0) - 1) }))}
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={counts[v.key] ?? 0}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setCounts((c) => ({ ...c, [v.key]: Number.isFinite(n) ? Math.min(5, Math.max(0, Math.round(n))) : 0 }));
                          }}
                        />
                        <button
                          type="button"
                          aria-label={`增加${v.label}`}
                          onClick={() => setCounts((c) => ({ ...c, [v.key]: Math.min(5, (c[v.key] ?? 0) + 1) }))}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </section>
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
                onToggle={() => setSettingsOpen((v) => !v)}
                ratio={ratio}
                onRatioChange={setRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
                capabilityId="main_image"
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
      <Modal
        open={expandOpen}
        title="编辑商品描述"
        okText="确定"
        cancelText="取消"
        onOk={() => setExpandOpen(false)}
        onCancel={() => setExpandOpen(false)}
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
