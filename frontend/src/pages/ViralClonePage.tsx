import { useCallback, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Maximize2, Plus, RefreshCw, X } from 'lucide-react';
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
 * 爆款复刻工作台 —— 1:1 复刻参考站 https://ijihua.cn/viral-clone。
 *
 * 版面数值来自参考站 computed styles 实拍 (1920×1080):
 *   上传商品图 / 生成设置卡 / 高级设置 popover 与 product-kit、product-detail 同类同值
 *   上传参考图（爆款图）: 独立 section, 400x160 虚线区 (同款 dropzone),
 *              plus 图标 margin-bottom 20; 标题行只有"从素材库导入/手机上传", 无计数器;
 *              文件输入不 multiple, 上限 1 张
 *   复刻要求: 独立卡 432x141 radius16 padding16; label 14px/700 #333;
 *              textarea 400x80 rows3 maxlength1000, padding 5px 36px 5px 12px, radius4
 *   复刻程度: 独立卡 432x155; 2 列 x 192 gap16; 选项 192x86 bg #F2F4F7 radius8
 *              padding 8px 16px flex-column gap8; 标题 14px #333 flex gap8 带 <i> 14x14
 *              圆点 (inactive: border 1px #C9CDD4; active: border 4px #625DF5 + 白底);
 *              说明 12px #86909C lh20; 默认选中"高度复刻"
 *
 * 接线: 商品图 + 参考图 → hot_remake 任务 (inputAssetIds 顺序即上传顺序,
 * 后端保序: [0]=商品图 [1]=参考图); 复刻程度 → degree 参数
 * (high_replica=参考图为底替换商品 / reference_style=提取参考图布局重建场景);
 * 复刻要求/名称/品牌 → 任务参数 (中文原文完整记录, 图内仅绘制 ASCII 部分);
 * 比例/画质 → ratio / size 参数。
 *
 * 诚实披露: hot_remake 为 mock 能力 (依赖真实 AI 模型), 本地为参数化占位渲染 ——
 * 空态与结果卡均有明示, 不用假效果冒充模型能力。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_IMAGES = 5;
const MAX_IMAGE_MB = 10;
const MAX_NAME_LEN = 100;
const MAX_REQUIREMENT_LEN = 1000;

/** 复刻程度两档 (实拍: 默认选中"高度复刻") */
const CLONE_DEGREES: Array<{ value: 'reference_style' | 'high_replica'; label: string; desc: string }> = [
  { value: 'reference_style', label: '参考风格', desc: '参考整体风格和结构，自动调整色彩和重构场景。' },
  { value: 'high_replica', label: '高度复刻', desc: '参照参考图视觉结构替换产品和文案，场景细节略有差异。' },
];

const DEGREE_LABEL: Record<string, string> = {
  reference_style: '参考风格',
  high_replica: '高度复刻',
};

interface PkAsset {
  id: string;
  url: string;
  name: string;
}

interface PkResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}

export function ViralClonePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  // ── 表单状态 ──
  const [images, setImages] = useState<PkAsset[]>([]);
  const [reference, setReference] = useState<PkAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [platform, setPlatform] = useState('taobao');
  const [language, setLanguage] = useState('zh-CN');
  const [requirement, setRequirement] = useState('');
  const [degree, setDegree] = useState<'reference_style' | 'high_replica'>('high_replica');
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);
  /** 素材库双通道: 本次导入写入商品图还是参考图（由触发按钮决定） */
  const [libraryTarget, setLibraryTarget] = useState<'product' | 'reference'>('product');

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PkResult | null>(null);
  const pollSignal = usePollAbort();

  // 参考站本页名称/品牌/复刻要求均为选填, 提交条件 = 商品图 ≥1 + 参考图 =1
  const formValid = images.length > 0 && reference !== null;

  // ── 上传: 商品图 (点击/拖拽/粘贴, 最多 5 张) ──
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

  // ── 上传: 参考图 (单张, 超出即替换) ──
  const uploadReference = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        message.warning('请选择图片文件（PNG / JPG / WebP / GIF）');
        return;
      }
      const file = list[0];
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${file.name}`);
        return;
      }
      setUploading(true);
      try {
        const projectId = await ensureProject();
        const asset = await assetsApi.upload(file, projectId);
        setReference({ id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name: file.name });
        message.success('参考图已上传（最多 1 张，新上传将替换原参考图）');
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [ensureProject, message],
  );

  const removeImage = (id: string) => setImages((prev) => prev.filter((x) => x.id !== id));

  // 拖拽 & 粘贴 (粘贴走商品图区, 与参考站主路径一致; 参考图支持点击/拖拽)
  const [dragging, setDragging] = useState(false);
  const [refDragging, setRefDragging] = useState(false);
  usePasteUpload(uploadFiles);

  // ── 素材库导入 (商品图 / 参考图共用) ──

  /** 返回 false = 拒绝本次选择(弹窗保持打开, 让用户改选) */
  const pickFromLibrary = (asset: Asset): boolean => {
    const name = asset.sourceUrl.split('/').pop() ?? '素材';
    if (libraryTarget === 'reference') {
      setReference({ id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name });
      return true;
    }
    if (images.length >= MAX_IMAGES) {
      message.warning(`最多上传 ${MAX_IMAGES} 张商品图片`);
      return false;
    }
    if (images.some((x) => x.id === asset.id)) {
      message.info('该素材已在列表中');
      return false;
    }
    setImages((prev) => [...prev, { id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name }]);
    return true;
  };

  // 素材库弹窗 (通用组件, 2026-10-19 抽取; 双通道: 商品图 / 参考图)
  const { open: libraryOpen, loading: libraryLoading, items: libraryItems, openLibrary, closeLibrary, pick } =
    useAssetLibrary(pickFromLibrary);
  const openLibraryFor = (target: 'product' | 'reference') => {
    setLibraryTarget(target);
    openLibrary();
  };

  // ── 生成 ──
  const pollTask = useCallback(
    (taskId: string) => pollToResult(taskId, { signal: pollSignal }),
    [pollSignal],
  );

  const submit = async () => {
    if (!formValid || !reference || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        capability: 'hot_remake',
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
      });
      const done = await pollTask(taskId);
      setResult(done);
      if (done.status === 'failed') message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
      else message.success('爆款复刻图已生成');
    } catch (e) {
      message.error((e as Error).message || '生成失败');
    } finally {
      setSubmitting(false);
    }
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
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/product-detail')}>
              商品详情
            </button>
            <button type="button" role="tab" aria-selected className="pk-editor-tab pk-editor-tab-active">
              爆款复刻
            </button>
          </div>

          <div className="pk-form-scroll">
            {/* 上传商品图 + 上传参考图 + 生成设置 (参考站同一张卡片) */}
            <section className="pk-config-card">
              <div className="pk-section">
                <div className="pk-upload-title-row">
                  <strong className="pk-section-title">
                    <i className="pk-required-mark">*</i>上传商品图
                  </strong>
                  <div className="pk-upload-title-actions">
                    <button type="button" className="pk-text-link" onClick={() => openLibraryFor('product')}>
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

              {/* 上传参考图（爆款图）: 独立 section, 单张上传, 标题行无计数器 */}
              <div className="pk-section vc-reference-section">
                <div className="pk-upload-title-row">
                  <strong className="pk-section-title">
                    <i className="pk-required-mark">*</i>上传参考图（爆款图）
                  </strong>
                  <div className="pk-upload-title-actions">
                    <button type="button" className="pk-text-link" onClick={() => openLibraryFor('reference')}>
                      从素材库导入
                    </button>
                    <button
                      type="button"
                      className="pk-text-link"
                      title="本地演示环境暂不支持手机上传"
                      onClick={() => message.info('本地演示环境暂不支持手机上传，可直接拖拽上传')}
                    >
                      手机上传
                    </button>
                  </div>
                </div>

                <div
                  className={`pk-dropzone pk-dropzone-reference${refDragging ? ' pk-dropzone-dragging' : ''}${reference ? ' pk-dropzone-filled' : ''}`}
                  onClick={() => referenceInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setRefDragging(true);
                  }}
                  onDragLeave={() => setRefDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setRefDragging(false);
                    void uploadReference(e.dataTransfer.files);
                  }}
                >
                  <input
                    ref={referenceInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      if (e.target.files) void uploadReference(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  {uploading && (
                    <div className="pk-dropzone-loading">
                      <Spin size="small" />
                    </div>
                  )}
                  {reference ? (
                    <div className="pk-thumb-grid pk-thumb-grid-single">
                      <div className="pk-thumb">
                        <img src={reference.url} alt={reference.name} loading="lazy" decoding="async" />
                        <button
                          type="button"
                          className="pk-thumb-remove"
                          aria-label={`移除 ${reference.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReference(null);
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="pk-upload-prompt">
                      <ImagePlus size={14} />
                      <span>点击、拖拽或粘贴参考图片到此处上传</span>
                      <small>上传或粘贴要复刻风格的参考图，最多 1 张，单张不超过 {MAX_IMAGE_MB}MB</small>
                    </label>
                  )}
                </div>
              </div>

              <div className="pk-section">
                <strong className="pk-section-title">生成设置</strong>
                <div className="pk-form-grid">
                  <label className="pk-field">
                    <span className="pk-field-label">商品名称（选填）</span>
                    <input
                      value={productName}
                      maxLength={MAX_NAME_LEN}
                      placeholder="请输入商品名称（选填）"
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
            </section>

            {/* 复刻要求 (独立卡) */}
            <section className="pk-config-card vc-requirement-card">
              <div className="pk-section">
                <strong className="pk-section-title">复刻要求</strong>
                <div className="pk-desc-editor">
                  <textarea
                    className="vc-requirement-textarea"
                    rows={3}
                    maxLength={MAX_REQUIREMENT_LEN}
                    value={requirement}
                    placeholder="例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。"
                    onChange={(e) => setRequirement(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pk-desc-expand"
                    aria-label="放大编辑复刻要求"
                    title="放大编辑"
                    onClick={() => setExpandOpen(true)}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </section>

            {/* 复刻程度 (独立卡, 默认高度复刻) */}
            <section className="pk-config-card vc-degree-card">
              <div className="pk-section">
                <strong className="pk-section-title">复刻程度</strong>
                <div className="pk-section-picker vc-degree-options" role="radiogroup" aria-label="复刻程度">
                  {CLONE_DEGREES.map((d) => {
                    const active = d.value === degree;
                    return (
                      <button
                        key={d.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`vc-degree-option${active ? ' vc-degree-option-active' : ''}`}
                        onClick={() => setDegree(d.value)}
                      >
                        <span className="vc-degree-title">
                          <i className="vc-degree-dot" aria-hidden />
                          {d.label}
                        </span>
                        <small>{d.desc}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>

          {/* 历史记录 (2026-10-19 接入通用组件; 此前本页无此功能) */}
          <ToolHistoryPanel capability="hot_remake" refreshKey={result} />

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
        {!result ? (
          <ToolEmptyState title="效果图预览" desc="提交任务后，生成结果将在此处展示">
            <ToolWorkflowSteps />
            <p className="vc-mock-note">
                本地演示：复刻结果为参数化占位渲染（真实复刻需接入 AI 模型），参考图会真实参与构图与配色
              </p>
          </ToolEmptyState>
        ) : (
          <div className="pk-result-body">
            <div className="pk-result-toolbar">
              <div className="pk-result-title">
                生成结果
                <span className="pk-result-count">{DEGREE_LABEL[degree]}</span>
              </div>
              <button type="button" className="pk-result-regen" disabled={submitting} onClick={() => void submit()}>
                <RefreshCw size={13} />
                重新生成
              </button>
            </div>
            <div className="pk-result-detail-scroll">
              {result.status === 'succeeded' && result.url ? (
                <div className="pk-result-card pk-result-card-detail">
                  <div className="pk-result-detail-media">
                    <img src={result.url} alt="爆款复刻图" />
                  </div>
                  <div className="pk-result-meta">
                    <span className="pk-result-variant">爆款复刻结果</span>
                    <span className="pk-result-mock-badge">本地占位渲染</span>
                    <span className="pk-result-params">
                      {DEGREE_LABEL[degree]} · {platform} · {ratio} · {resolution.toUpperCase()}
                      {result.width && result.height ? ` · ${result.width}×${result.height}` : ''}
                    </span>
                  </div>
                  <a className="pk-result-download" href={result.url} download target="_blank" rel="noreferrer">
                    下载原图
                  </a>
                </div>
              ) : (
                <div className="pk-result-card pk-result-card-detail">
                  <div className="pk-result-detail-media pk-result-failed">
                    <X size={20} />
                    <span>生成失败（{result.errorCode ?? '未知错误'}）</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 素材库选择弹窗 (真实数据; 按 libraryTarget 决定写入商品图还是参考图) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        onCancel={closeLibrary}
        onPick={pick}
      />

      {/* 复刻要求放大编辑 */}
      <Modal
        open={expandOpen}
        title="编辑复刻要求"
        okText="确定"
        cancelText="取消"
        onOk={() => setExpandOpen(false)}
        onCancel={() => setExpandOpen(false)}
      >
        <textarea
          className="pk-expand-textarea"
          rows={10}
          maxLength={MAX_REQUIREMENT_LEN}
          value={requirement}
          placeholder="例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。"
          onChange={(e) => setRequirement(e.target.value)}
        />
      </Modal>
    </div>
  );
}

