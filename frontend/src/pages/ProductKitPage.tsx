import { useCallback, useMemo, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Maximize2, Minus, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { assetsApi, generateApi, toAbsoluteUrl } from '../lib/api';
import { languageOptions, platformOptions } from '../lib/optionSets';

import { ToolEmptyState, ToolWorkflowSteps } from '../components/ToolEmptyState';
import { ToolSubmitBar } from '../components/ToolSubmitBar';
import { ToolHistoryPanel } from '../components/ToolHistoryPanel';
import { ToolSettingsPopover } from '../components/ToolSettingsPopover';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { pollToResult } from '../lib/poll';
import type { Asset, TaskStatus } from '../types/api';

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
 * 不接入视觉模型的能力 (AI分析) 只填入素材真实元数据, 不编造识别结果。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_IMAGES = 5;
const MAX_IMAGE_MB = 10; // 参考站文案: 单张不超过 10MB
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

interface PkAsset {
  id: string;
  url: string;
  name: string;
}

interface PkResult {
  taskId: string;
  variant: string;
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}

export function ProductKitPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 表单状态 ──
  const [images, setImages] = useState<PkAsset[]>([]);
  const [uploading, setUploading] = useState(false);
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

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<PkResult[]>([]);
  const pollSignal = usePollAbort();

  const totalCount = useMemo(
    () => VARIANT_FIELDS.reduce((sum, v) => sum + (counts[v.key] ?? 0), 0),
    [counts],
  );
  const formValid = images.length > 0 && productName.trim().length > 0 && description.trim().length > 0 && totalCount > 0;

  // ── 上传 ──
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        message.warning('请选择图片文件（PNG / JPG / WebP / GIF）');
        return;
      }
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${MAX_IMAGES} 张商品图片`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      const oversize = accepted.filter((f) => f.size > MAX_IMAGE_MB * 1024 * 1024);
      if (oversize.length > 0) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((f) => f.name).join('、')}`);
        return;
      }

      setUploading(true);
      try {
        const projectId = await ensureProject();
        const uploaded: PkAsset[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name: file.name });
        }
        setImages((prev) => [...prev, ...uploaded]);
        message.success(`已上传 ${uploaded.length} 张商品图片`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [images.length, ensureProject, message],
  );

  const removeImage = (id: string) => setImages((prev) => prev.filter((x) => x.id !== id));

  // 拖拽 & 粘贴 (参考站支持三种上传方式)
  const [dragging, setDragging] = useState(false);
  usePasteUpload(uploadFiles);

  // ── 素材库导入 ──

  const pickFromLibrary = (asset: Asset) => {
    if (images.length >= MAX_IMAGES) {
      message.warning(`最多上传 ${MAX_IMAGES} 张商品图片`);
      return;
    }
    if (images.some((x) => x.id === asset.id)) {
      message.info('该素材已在列表中');
      return;
    }
    setImages((prev) => [
      ...prev,
      { id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name: asset.sourceUrl.split('/').pop() ?? '素材' },
    ]);
  };

  // 素材库弹窗 (通用组件, 2026-10-19 抽取; 各页只提供点选回填逻辑)
  const { open: libraryOpen, loading: libraryLoading, items: libraryItems, openLibrary, closeLibrary, pick } =
    useAssetLibrary(pickFromLibrary);

  // ── AI分析: 只填素材真实元数据, 不编造视觉识别结果 ──
  const runAiAnalyze = () => {
    if (images.length === 0) {
      message.warning('请先上传商品图片');
      return;
    }
    const lines = images.map((img, i) => `商品图${i + 1}：${img.name}`);
    setDescription(lines.join('\n'));
    message.success('已填入上传素材的真实文件名；本地演示未接入视觉模型，暂不能识别商品内容');
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
    if (!formValid || submitting) return;
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
      const failed = done.filter((r) => r.status !== 'succeeded').length;
      if (failed > 0) message.error(`${failed} 张生成失败，请重试`);
      else message.success(`已生成 ${done.length} 张商品主图`);
    } catch (e) {
      message.error((e as Error).message || '生成失败');
    } finally {
      setSubmitting(false);
    }
  };

  const succeeded = results.filter((r) => r.status === 'succeeded');

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
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/tools/detail_image')}>
              商品详情
            </button>
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/viral-clone')}>
              爆款复刻
            </button>
          </div>

          <div className="pk-form-scroll">
            {/* 上传商品图 + 生成设置 + 商品描述 (参考站同一张卡片) */}
            <section className="pk-config-card">
              <div className="pk-section">
                <div className="pk-upload-title-row">
                  <strong className="pk-section-title">
                    <i className="pk-required-mark">*</i>上传商品图
                  </strong>
                  <div className="pk-upload-title-actions">
                    <button type="button" className="pk-text-link" onClick={() => openLibrary()}>
                      从素材库导入
                    </button>
                    <button
                      type="button"
                      className="pk-text-link"
                      title="本地演示环境暂不支持手机上传"
                      onClick={() => message.info('本地演示环境暂不支持手机上传，可直接拖拽或粘贴上传')}
                    >
                      手机上传
                    </button>
                    <span className="pk-upload-count">
                      {images.length}/{MAX_IMAGES}
                    </span>
                  </div>
                </div>

                <div
                  className={`pk-dropzone${dragging ? ' pk-dropzone-dragging' : ''}${images.length > 0 ? ' pk-dropzone-filled' : ''}`}
                  onClick={() => images.length < MAX_IMAGES && fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  {uploading && (
                    <div className="pk-dropzone-loading">
                      <Spin size="small" />
                    </div>
                  )}
                  {images.length === 0 ? (
                    <label className="pk-upload-prompt">
                      <ImagePlus size={14} />
                      <span>点击、拖拽或粘贴商品图片到此处上传</span>
                      <small>最多可上传 {MAX_IMAGES} 张商品图片，单张不超过 {MAX_IMAGE_MB}MB</small>
                    </label>
                  ) : (
                    <div className="pk-thumb-grid">
                      {images.map((img) => (
                        <div key={img.id} className="pk-thumb">
                          <img src={img.url} alt={img.name} loading="lazy" decoding="async" />
                          <button
                            type="button"
                            className="pk-thumb-remove"
                            aria-label={`移除 ${img.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeImage(img.id);
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      {images.length < MAX_IMAGES && (
                        <button type="button" className="pk-thumb-add" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

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
                    <button type="button" className="pk-ai-btn" onClick={runAiAnalyze}>
                      <Sparkles size={12} />
                      <span>AI分析</span>
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

          {/* 历史记录 (2026-10-19 接入通用组件; 此前本页无此功能) */}
          <ToolHistoryPanel capability="main_image" refreshKey={results} />

          {/* 高级设置 + 提交 (sticky 底部) */}
          {/* 高级设置 + 提交 (sticky 底部) */}
          <ToolSubmitBar
            submitting={submitting}
            disabled={!formValid}
            label="免费生图"
            settings={
              <ToolSettingsPopover
                open={settingsOpen}
                onToggle={() => setSettingsOpen((v) => !v)}
                ratio={ratio}
                onRatioChange={setRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
              />
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 ── */}
      <section className="pk-result-pane">
        {results.length === 0 ? (
          <ToolEmptyState title="效果图预览" desc="提交任务后，生成结果将在此处展示">
            <ToolWorkflowSteps />
          </ToolEmptyState>
        ) : (
          <div className="pk-result-body">
            <div className="pk-result-toolbar">
              <div className="pk-result-title">
                生成结果
                <span className="pk-result-count">
                  {succeeded.length}/{results.length}
                </span>
              </div>
              <button type="button" className="pk-result-regen" disabled={submitting} onClick={() => void submit()}>
                <RefreshCw size={13} />
                重新生成
              </button>
            </div>
            <div className="pk-result-grid" style={{ ['--pk-aspect' as string]: ratio.replace(':', ' / ') }}>
              {results.map((r, i) => (
                <div key={`${r.taskId}-${i}`} className="pk-result-card">
                  <div className="pk-result-media">
                    {r.status === 'succeeded' && r.url ? (
                      <img src={r.url} alt={`${VARIANT_LABELS[r.variant] ?? r.variant} ${i + 1}`} />
                    ) : (
                      <div className="pk-result-failed">
                        <X size={20} />
                        <span>生成失败（{r.errorCode ?? '未知错误'}）</span>
                      </div>
                    )}
                  </div>
                  <div className="pk-result-meta">
                    <span className="pk-result-variant">{VARIANT_LABELS[r.variant] ?? r.variant}</span>
                    <span className="pk-result-params">
                      {platform} · {ratio} · {resolution.toUpperCase()}
                      {r.width && r.height ? ` · ${r.width}×${r.height}` : ''}
                    </span>
                  </div>
                  {r.status === 'succeeded' && r.url && (
                    <a className="pk-result-download" href={r.url} download target="_blank" rel="noreferrer">
                      下载原图
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 素材库选择弹窗 (真实数据) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        onCancel={closeLibrary}
        onPick={pickFromLibrary}
      />

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

