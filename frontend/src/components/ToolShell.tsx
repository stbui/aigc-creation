import { useCallback, useRef, useState, type ReactNode } from 'react';
import { App, Modal, Spin } from 'antd';
import { ImagePlus, Maximize2, RefreshCw, X } from 'lucide-react';
import { assetsApi, toAbsoluteUrl } from '../lib/api';

import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { AssetLibraryModal } from './AssetLibraryModal';
import { ToolSettingsPopover } from './ToolSettingsPopover';
import { ToolSubmitBar } from './ToolSubmitBar';
import { ToolEmptyState, ToolGeneratingState } from './ToolEmptyState';
import { ResultMedia, formatDuration } from './ResultMedia';
import { pollToResult } from '../lib/poll';
import type { Asset, Modality, Task, TaskStatus } from '../types/api';

/**
 * 修图系工具页共享骨架 —— 1:1 复刻参考站 local-redraw / background-remove 等页的公共结构:
 *   左栏 432px: 上传卡 (* 上传图片 + 从素材库导入[disabled] + 手机上传 + dropzone)
 *              → 业务卡 (children, 各页自定义)
 *              → 提交区 (高级设置 popover + 主按钮, sticky 底部)
 *              → 历史记录 (可折叠, 真实任务数据)
 *   右栏: 结果预览 (空态插画 + 说明 / 生成结果 + 重新生成)
 * 上传/设置/提交/结果的视觉与 pk-* (product-kit) 完全同源, 业务差异由 children 与配置注入。
 */

export interface ToolAsset {
  id: string;
  url: string;
  name: string;
}

export interface ToolResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
  /**
   * 产出模态 (2026-10-20 视频通道落地)。
   *
   * ⚠️ 可选: 后端在视频通道落地前只返回图像产出, 没有该字段。
   * 故渲染时按「有值且为 video」判定, 缺省按图片处理 ——
   * 不能反过来 (缺省当视频会让存量产出全变白屏)。
   */
  modality?: Modality;
  /** 视频时长 (毫秒); 仅 video 模态有值 */
  durationMs?: number | null;
}

export interface ToolSettings {
  ratio: string;
  resolution: string;
}

interface UploadSpec {
  title: string;
  required?: boolean;
  max: number;
  /** dropzone 内的小字说明 */
  hint: string;
  /** 主提示语 (默认: 点击或拖拽图片到此处上传) */
  prompt?: string;
  accept?: string;
}

interface SettingsSpec {
  /** 比例组 (含"原比例"首项; 参考站修图系默认原比例) */
  ratio?: boolean;
  /** 分辨率组 (1K/2K, 4K 如实禁用) */
  resolution?: boolean;
  defaultRatio?: string;
}

interface Props {
  /** 能力 id (提交任务与历史过滤) */
  capability: string;
  /** 页标题 (空态 h3 与结果栏标题) */
  title: string;
  /** 提交按钮下方的一句话描述 (参考站各页固定文案) */
  desc: string;
  /** 上传卡规格; 传 null 表示页面自带上传区 (如 SKU 模板卡 / 多图融合双上传区) */
  upload: UploadSpec | null;
  settings?: SettingsSpec;
  /** 提交按钮主文案 */
  submitLabel: string;
  /**
   * 按钮内积分/免费角标 (**留空即由 ToolShell 按能力自动解析**)。
   *
   * 2026-10-20 起不再要求各页硬编码 —— 硬编码那份是纯文案, 与实际扣费无关,
   * 后台改价后 8 个页面会集体说谎。自动解析读的是后端下发的 creditCost。
   * 仍保留此 prop 只为个别页覆写 (如 SKU 图需显示与 registry 不同的口径)。
   */
  creditLabel?: string;
  /** 提交按钮上方的提示行 (参考站部分页有 '* 确认素材和参数后提交…') */
  hint?: string;
  /** mock 能力诚实披露 (空态与结果徽标) */
  mockNote?: string;
  /** 空态描述 */
  emptyDesc: string;
  /** 业务卡 (上传卡与提交区之间) */
  children?: ReactNode;
  /** 提交条件 */
  formValid: boolean;
  submitting: boolean;
  result: ToolResult | ToolResult[] | null;
  /** 结果标签 (如复刻程度/SKU 名, 显示在结果卡上) */
  resultTag?: string;
  /** 提交: 输入按上传顺序给出, 设置含比例/画质 */
  onSubmit: (inputs: ToolAsset[], settings: ToolSettings) => Promise<void>;
  /** 结果操作区附加按钮 (如 SKU 页的一键下载) */
  resultActions?: ReactNode;
}

const RATIO_LABEL: Record<string, string> = { original: '原比例' };

export function ToolShell(props: Props) {
  /**
   * 自动消耗价。capability 已由本组件持有, 无需各页再传一遍 ——
   * 让「价格跟着能力走」而不是「跟着页面记忆走」。
   */
  const autoCreditLabel = useCreditLabel(props.capability);
  const {
    capability,
    title,
    desc,
    upload,
    settings,
    submitLabel,
    creditLabel,
    hint,
    mockNote,
    emptyDesc,
    children,
    formValid,
    submitting,
    result,
    resultTag,
    onSubmit,
    resultActions,
  } = props;

  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<ToolAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ratio, setRatio] = useState(settings?.defaultRatio ?? 'original');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 素材库导入 (参考站该按钮 disabled, 本地演示如实禁用并提示)
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState<Asset[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  /**
   * 素材库加载失败必须与「无素材」分开 (2026-10-20 修)。
   * 此前失败只弹 message.error, 弹窗内照常渲染「素材库暂无原始图片」——
   * 用户以为是自己没上传过, 真相是接口没连上。
   */
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!upload) return;
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        message.warning('请选择图片文件（PNG / JPG / WebP）');
        return;
      }
      const room = upload.max - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${upload.max} 张图片`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      setUploading(true);
      try {
        const projectId = await ensureProject();
        const uploaded: ToolAsset[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name: file.name });
        }
        setImages((prev) => [...prev, ...uploaded]);
        message.success(`已上传 ${uploaded.length} 张图片`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [images.length, ensureProject, message, upload],
  );

  // 粘贴上传 (参考站支持直接粘贴)
  usePasteUpload(uploadFiles);

  const removeImage = (id: string) => setImages((prev) => prev.filter((x) => x.id !== id));

  const submit = async () => {
    if (!formValid || submitting) return;
    await onSubmit(images, { ratio, resolution });
  };

  const results: ToolResult[] = result === null ? [] : Array.isArray(result) ? result : [result];
  const showResult = results.length > 0;

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <aside className="pk-input-pane">
        <div className="pk-form-card">
          <div className="pk-form-scroll">
            {/* 上传卡 (页面自带上传区时跳过) */}
            {upload && (
              <section className="pk-config-card">
                <div className="pk-section">
                  <div className="pk-upload-title-row">
                    <strong className="pk-section-title">
                      {upload.required && <i className="pk-required-mark">*</i>}
                      {upload.title}
                    </strong>
                    <div className="pk-upload-title-actions">
                      <button
                        type="button"
                        className="pk-text-link"
                        disabled
                        title="本地演示环境暂不支持素材库导入"
                        onClick={() => {
                          setLibraryOpen(true);
                          setLibraryLoading(true);
                          setLibraryError(null);
                          assetsApi
                            .list({ kind: 'original', limit: 60 })
                            .then((res) => setLibraryItems(res.items ?? []))
                            .catch((e: unknown) => {
                              setLibraryError(e instanceof Error ? e.message : '素材库加载失败');
                              message.error('素材库加载失败');
                            })
                            .finally(() => setLibraryLoading(false));
                        }}
                      >
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
                      {upload.max > 1 && (
                        <span className="pk-upload-count">
                          {images.length}/{upload.max}
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    className={`pk-dropzone${dragging ? ' pk-dropzone-dragging' : ''}${images.length > 0 ? ' pk-dropzone-filled' : ''}`}
                    onClick={() => images.length < upload.max && fileInputRef.current?.click()}
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
                      accept={upload.accept ?? 'image/png,image/jpeg,image/webp'}
                      multiple={upload.max > 1}
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
                        <ImagePlus size={22} />
                        <span>{upload.prompt ?? '点击或拖拽图片到此处上传'}</span>
                        <small>{upload.hint}</small>
                      </label>
                    ) : (
                      <div className={`pk-thumb-grid${images.length === 1 ? ' pk-thumb-grid-single' : ''}`}>
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
                        {images.length < upload.max && (
                          <button
                            type="button"
                            className="pk-thumb-add"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                          >
                            <ImagePlus size={18} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* 业务卡 */}
            {children}

          </div>

          {/* 提交区 (sticky 底部) */}
          <ToolSubmitBar
            submitting={submitting}
            disabled={!formValid}
            label={submitLabel}
            creditLabel={creditLabel ?? autoCreditLabel ?? undefined}
            desc={desc}
            hint={hint}
            settings={
              settings && (settings.ratio || settings.resolution) ? (
                <ToolSettingsPopover
                  open={settingsOpen}
                  onToggle={() => setSettingsOpen((v) => !v)}
                  ratio={ratio}
                  onRatioChange={setRatio}
                  resolution={resolution}
                  onResolutionChange={setResolution}
                  showRatio={Boolean(settings.ratio)}
                  showResolution={Boolean(settings.resolution)}
                  resolutionTitle="分辨率（积分/权益消耗）"
                />
              ) : null
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 ── */}
      <section className="pk-result-pane">
        {/*
          三态必须分开 (2026-10-20 修)。

          此前只有「有结果 / 没结果」两态, 而提交任务时 `useToolTask.run` 会先
          `setResult(null)`, 于是结果栏在生成期间整块退回空态插画,
          文案还写着「提交任务后，生成结果将在此处展示」—— 用户明明已经点了生成,
          却看到"你还没提交"。这是**欺骗性 UI**: 慢模型(数秒到数十秒)下尤其刺眼,
          用户会以为按钮没生效而重复点击。

          现在: 生成中 → 骨架占位; 失败 → 失败卡; 成功 → 结果图; 都没发生 → 空态。
        */}
        {submitting && !showResult ? (
          <ToolGeneratingState />
        ) : !showResult ? (
          <ToolEmptyState title={title} desc={emptyDesc}>
              {mockNote && <p className="tool-mock-note">{mockNote}</p>}
            </ToolEmptyState>
        ) : (
          <div className="pk-result-body">
            <div className="pk-result-toolbar">
              <div className="pk-result-title">
                生成结果
                {resultTag && <span className="pk-result-count">{resultTag}</span>}
              </div>
              <div className="tool-result-actions">
                {resultActions}
                <button type="button" className="pk-result-regen" disabled={submitting} onClick={() => void submit()}>
                  <RefreshCw size={13} />
                  重新生成
                </button>
              </div>
            </div>
            <div className="pk-result-detail-scroll">
              <div className={`tool-result-grid${results.length > 1 ? ' tool-result-grid-multi' : ''}`}>
                {results.map((r, i) =>
                  r.status === 'succeeded' && r.url ? (
                    <div key={i} className="pk-result-card pk-result-card-detail">
                      <div className="pk-result-detail-media">
                        <ResultMedia
                          url={r.url}
                          modality={r.modality}
                          alt={`${title}结果 ${i + 1}`}
                        />
                      </div>
                      <div className="pk-result-meta">
                        <span className="pk-result-variant">{title}结果</span>
                        {mockNote && <span className="pk-result-mock-badge">本地占位渲染</span>}
                        <span className="pk-result-params">
                          {r.width && r.height ? `${r.width}×${r.height}` : ''}
                          {/* 视频没有宽高可显示 (Jimp 不解视频), 故显示时长 */}
                          {formatDuration(r.durationMs) ? ` · ${formatDuration(r.durationMs)}` : ''}
                        </span>
                      </div>
                      <a className="pk-result-download" href={r.url} download target="_blank" rel="noreferrer">
                        下载原图
                      </a>
                    </div>
                  ) : (
                    <div key={i} className="pk-result-card pk-result-card-detail">
                      <div className="pk-result-detail-media pk-result-failed">
                        <X size={20} />
                        <span>生成失败（{r.errorCode ?? '未知错误'}）</span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 素材库弹窗 (参考站该入口 disabled, 保留真实数据兜底: 打开可看不可选) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={() => setLibraryOpen(false)}
        onPick={() => undefined}
        readOnly
      />
    </div>
  );
}

/** 空态插画: 与 pk/vc/fc 同一张内联 SVG (不使用参考站图片资源) */
export { ToolEmptyIllustration } from './illustrations';

/** 任务轮询工具: 各页提交后复用 (薄封装, 轮询实现统一在 lib/poll.ts) */
export function useTaskPoller() {
  const signal = usePollAbort();
  return useCallback((taskId: string) => pollToResult(taskId, { signal }), [signal]);
}

/** 放大编辑弹窗 (补充要求/提示词等 textarea 共用; Maximize2 图标与参考站一致) */
export function ExpandTextModal({
  open,
  title,
  value,
  maxLength,
  placeholder,
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} okText="确定" cancelText="取消" onOk={onClose} onCancel={onClose}>
      <textarea
        className="pk-expand-textarea"
        rows={10}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Modal>
  );
}

export { Maximize2 };
