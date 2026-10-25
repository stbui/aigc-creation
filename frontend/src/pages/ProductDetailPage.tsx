import { useCallback, useState } from 'react';
import { App, Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Sparkles } from 'lucide-react';
import { generateApi, promptToolsApi } from '../lib/api';
import { MAX_IMAGE_MB, taskErrorText } from '../lib/constants';
import { languageOptions, platformOptions } from '../lib/optionSets';

import { ToolWorkflowSteps } from '../components/ToolEmptyState';
import { ToolSubmitBar } from '../components/ToolSubmitBar';
import { ToolImageDropzone } from '../components/ToolImageDropzone';
import { ToolSettingsPopover } from '../components/ToolSettingsPopover';
import { AssetLibraryModal } from '../components/AssetLibraryModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
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
 * 商品详情图工作台 —— 1:1 复刻参考站 https://ijihua.cn/product-detail。
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
 * (逗号分隔模块键, 后端按键渲染长图区块, 选不同模块产出不同版面);
 * 画质 → size 参数 (1K/2K/4K; 4K 只有云端通道能兑现, 本地时置灰并说明)。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_IMAGES = 5;
const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 5000;
const MAX_SECTIONS = 10;

/** 参考站"包含模块"16 项 (value 与后端 registry DETAIL_SECTIONS 一致) */
const SECTION_MODULES = [
  { value: 'hero', label: '首屏主视觉', desc: '传递核心价值' },
  { value: 'selling_points', label: '核心卖点图', desc: '突出差异优势' },
  { value: 'usage_scene', label: '使用场景图', desc: '呈现真实使用场景' },
  { value: 'multi_angle', label: '多角度图', desc: '多角度呈现外观' },
  { value: 'scene_atmosphere', label: '场景氛围图', desc: '展示使用场景' },
  { value: 'product_detail', label: '商品细节图', desc: '放大材质与工艺' },
  { value: 'brand_story', label: '品牌故事图', desc: '传达品牌理念' },
  { value: 'size_spec', label: '尺寸/容量/尺码图', desc: '展示规格信息' },
  { value: 'effect_compare', label: '效果对比图', desc: '使用前后效果对比' },
  { value: 'spec_table', label: '详细规格/参数表', desc: '展示详细商品数据' },
  { value: 'craft_process', label: '工艺制作图', desc: '展示工艺制作过程' },
  { value: 'accessories', label: '配件/随箱物品图', desc: '明确收到的配件、零配件和随购赠送物品' },
  { value: 'series_display', label: '系列展示图', desc: '多色或多SKU展示' },
  { value: 'ingredients', label: '商品成分图', desc: '展示配方/材质/成分' },
  { value: 'after_sale', label: '售后保障图', desc: '说明质保退换政策' },
  { value: 'usage_tips', label: '使用建议图', desc: '商品使用的注意事项' },
];

/** 默认勾选前 6 项 (参考站初始状态 已选 6/10) */
const DEFAULT_SECTIONS = SECTION_MODULES.slice(0, 6).map((s) => s.value);

interface PkResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}

/**
 * 任务参数里的模块清单 → 缩略图标签。
 *
 * 详情图一次只出一种长图, 没有「变体」这个维度; 真正会改变版面的是
 * 「包含哪些模块」(选 3 个和选 10 个模块, 长图的区块数完全不同)。
 * 所以标签标模块数, 而不是抄一个和这张图无关的分类名。
 */
function sectionCaption(params: Record<string, unknown>): string | undefined {
  const raw = params?.sections;
  if (typeof raw !== 'string') return undefined;
  const n = raw.split(',').filter(Boolean).length;
  return n > 0 ? `${n} 个模块` : undefined;
}

export function ProductDetailPage() {
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
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** AI 分析进行中 (按钮禁用 + 文案切换, 防止连点时重复请求文本通道) */
  const [analyzing, setAnalyzing] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  // 实时价来自能力清单（后台可调价），按钮文案不能再写死「免费生图」
  const creditLabel = useCreditLabel('detail_image');
  const { blocked: capabilityBlocked, reason: capabilityReason } = useCapabilityRuntime('detail_image');
  /** 最近这一次提交的结果 (只用于提示行; 历史产出由 gallery 维护) */
  const [result, setResult] = useState<PkResult | null>(null);
  const pollSignal = usePollAbort();

  // ── 右侧结果栏 ──
  //
  // 与创意生图页、商品主图页同构: 网格展示本能力**全部**历史产出,
  // 用户可以回看不同模块组合的版面; 本次出图由 gallery.prepend 插到榜首。
  const { token } = useAuth();
  const gallery = useResultGallery({ capability: 'detail_image', token, captionOf: sectionCaption });
  // 服务端仍有 running/pending 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢
  const generating = submitting || gallery.items.some((item) => !item.url);

  const formValid =
    images.length > 0 && productName.trim().length > 0 && description.trim().length > 0 && sections.length > 0;

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

  // ── 模块选择 (上限 10, 与参考站"已选 N/10"一致) ──
  const toggleSection = (value: string) => {
    setSections((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= MAX_SECTIONS) {
        message.warning(`最多选择 ${MAX_SECTIONS} 个模块`);
        return prev;
      }
      // 保持参考站模块固定顺序 (不按点击顺序重排)
      return SECTION_MODULES.map((s) => s.value).filter((v) => v === value || prev.includes(v));
    });
  };

  // ── 生成 ──
  const pollTask = useCallback(
    (taskId: string) => pollToResult(taskId, { signal: pollSignal }),
    [pollSignal],
  );

  const submit = async () => {
    if (!formValid || generating) return;
    // guest 点击仍应走登录弹窗；已登录时才把「能力不可用」作为硬拦截。
    if (token && capabilityBlocked) {
      message.warning(capabilityReason || '该能力当前不可提交');
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        capability: 'detail_image',
        inputAssetIds: images.map((x) => x.id),
        params: {
          productName: productName.trim(),
          brand: brand.trim(),
          platform,
          language,
          description: description.trim(),
          sections: sections.join(','),
          size: resolution,
        },
      });
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
          width: done.width ?? null,
          height: done.height ?? null,
          createdAt: new Date().toISOString(),
          caption: `${sections.length} 个模块`,
        };
        gallery.prepend([fresh]);
      }
      if (done.status === 'failed') message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
      else message.success('商品详情图已生成');
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  /**
   * 删除一张生成图 —— DELETE /tasks/:id 会连带删掉产出素材与磁盘文件。
   *
   * 与创意生图 / 商品主图页同款确认框: 删除不可逆, 且用户此时看到的是缩略图,
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
                  <label className="pk-field">
                    <span className="pk-field-label">平台</span>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                      {platformOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pk-field">
                    <span className="pk-field-label">语言</span>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      {languageOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
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

            {/* 包含模块（多选） */}
            <section className="pk-config-card pk-detail-card">
              <div className="pk-section">
                <div className="pk-section-title-row">
                  <strong className="pk-section-title">包含模块（多选）</strong>
                  <span className="pk-section-counter">
                    已选 {sections.length}/{MAX_SECTIONS}
                  </span>
                </div>
                <div className="pk-section-picker">
                  {SECTION_MODULES.map((m) => {
                    const checked = sections.includes(m.value);
                    const atLimit = !checked && sections.length >= MAX_SECTIONS;
                    return (
                      <label
                        key={m.value}
                        className={`pk-section-option${checked ? ' pk-section-option-selected' : ''}${atLimit ? ' pk-section-option-limit' : ''}`}
                        title={atLimit ? `最多选择 ${MAX_SECTIONS} 个模块` : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={atLimit}
                          onChange={() => toggleSection(m.value)}
                        />
                        <span>
                          <strong>{m.label}</strong>
                          <small>{m.desc}</small>
                        </span>
                      </label>
                    );
                  })}
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
                resolution={resolution}
                onResolutionChange={setResolution}
                capabilityId="detail_image"
                showRatio={false}
              />
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 (本能力全部生成图) ──
          与创意生图页同构的全部产出网格; 本次出图由 gallery.prepend 插到榜首,
          生成中画一张占位卡。 */}
      <ResultGalleryPane
        title={generating ? '生成中…' : '全部生成图'}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        notice={
          result && result.status === 'failed' ? (
            <p className="tool-submit-notice tool-submit-notice-error">
              本次生成失败：{taskErrorText(result.errorCode)}，可重新生成
            </p>
          ) : null
        }
        pending={submitting ? [{ key: 'detail', label: '商品详情长图' }] : []}
        emptyTitle="效果图预览"
        emptyDesc={
          token
            ? '提交任务后，生成结果将在此处展示，本页生成过的图都会保留在这里'
            : '登录后，你在这个页面生成过的图都会显示在这里'
        }
        emptyChildren={<ToolWorkflowSteps />}
        onRefresh={() => void gallery.reload()}
        onDelete={deleteImage}
        downloadNamePrefix="product-detail"
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
