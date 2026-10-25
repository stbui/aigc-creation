import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Modal, Spin } from 'antd';
import { ImagePlus, Maximize2, RefreshCw, X } from 'lucide-react';
import { assetsApi, assetSrc, toAbsoluteUrl } from '../lib/api';

import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useCapabilities } from '../hooks/useCapabilities';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { useAuth } from '../context/AuthContext';
import { AssetLibraryModal, useAssetLibrary } from './AssetLibraryModal';
import { MobileUploadModal } from './MobileUploadModal';
import { ToolSettingsPopover } from './ToolSettingsPopover';
import { ToolSubmitBar } from './ToolSubmitBar';
import { ToolEmptyState, ToolGeneratingState } from './ToolEmptyState';
import { ResultMedia, formatDuration } from './ResultMedia';
import { ProviderBadge } from './ProviderBadge';
import { ImageCompare } from './ImageCompare';
import { ImageLightbox } from './ImageLightbox';
import { pollToResult } from '../lib/poll';
import { taskErrorText } from '../lib/constants';
import type { Asset, MobileUploadAsset, Modality, Task, TaskStatus } from '../types/api';

/**
 * 修图系工具页共享骨架 —— 1:1 复刻参考站 local-redraw / background-remove 等页的公共结构:
 *   左栏 432px: 上传卡 (* 上传图片 + 从素材库导入 + 手机上传 + dropzone)
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
   * 本次实际通道: gateway=真实模型 / local=本地算法。
   *
   * 由 `lib/poll.ts` 的 pollToResult 透出。结果卡按它显示徽标 ——
   * 同一能力云端可用时是模型产出、云端故障时是本地回落, 必须如实区分,
   * 不能按能力的静态 mode 猜。
   */
  provider?: string | null;
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

/** 结果卡里的原图/结果图分割对比；不传时仍显示普通结果预览。 */
export interface ToolResultCompare {
  beforeUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/** 修图页共用历史栏的收起状态；由 ToolShell 持有，ToolHistoryPane 消费。 */
export interface ToolTrailingControl {
  collapsed: boolean;
  toggle: () => void;
}

export const ToolTrailingContext = createContext<ToolTrailingControl | null>(null);

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
  /** 分辨率组 (1K/2K/4K; 4K 在该能力无云端通道时禁用, 见 lib/optionSets) */
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
  /** 空态描述 */
  emptyDesc: string;
  /**
   * 业务卡 (上传卡与提交区之间)。
   *
   * 传函数时**每次渲染都会拿到当前已上传的图片** —— 局部重绘要用它当画布底图
   * （涂抹出的遮罩必须与原图同尺寸）。传普通节点则与改造前一致。
   */
  children?: ReactNode | ((images: ToolAsset[]) => ReactNode);
  /** 提交条件 */
  formValid: boolean;
  submitting: boolean;
  result: ToolResult | ToolResult[] | null;
  /** 结果标签 (如复刻程度/SKU 名, 显示在结果卡上) */
  resultTag?: string;
  /** 提交: 输入按上传顺序给出, 设置含比例/画质 */
  onSubmit: (inputs: ToolAsset[], settings: ToolSettings) => Promise<void>;
  /** 高级设置变化 (结果编辑器需要与比例保持同步时使用) */
  onSettingsChange?: (settings: ToolSettings) => void;
  /** 结果操作区附加按钮 (如批量下载) */
  resultActions?: ReactNode;
  /** 结果卡内嵌原图/结果对比 (局部重绘、去水印)；多图结果不启用 */
  resultCompare?: ToolResultCompare;
  /**
   * 替换默认结果栏。商品 SKU 图需要与商品主图共用「全部生成图」网格，
   * 但左栏仍复用这里的上传/提交骨架，故由页面注入自己的结果面板。
   */
  resultPane?: ReactNode;
  /**
   * 结果栏空态的业务面板 (无结果时替换通用空态插画)。
   *
   * 局部重绘把涂抹画布放在右栏宽区 —— 左栏 432px 对着一张大图涂抹太挤;
   * 传入函数形态时可读到当前已上传的图片 (与 children 同约定)。
   * 返回 null 时回落默认空态, 页面可以只在「有图」时才接管这块。
   */
  sourcePane?: ReactNode | ((images: ToolAsset[]) => ReactNode);
  /**
   * 右侧附加栏 (局部重绘的常驻历史记录)。
   *
   * 只有传了这个 prop 的页面才切成三栏 —— 其余工具页继续沿用
   * 「输入 + 结果」两栏，不受参考站历史侧栏改版影响。
   */
  trailingPane?: ReactNode;
}

const RATIO_LABEL: Record<string, string> = { original: '原比例' };

export function ToolShell(props: Props) {
  /**
   * 自动消耗价。capability 已由本组件持有, 无需各页再传一遍 ——
   * 让「价格跟着能力走」而不是「跟着页面记忆走」。
   */
  const autoCreditLabel = useCreditLabel(props.capability);

  /*
   * 该项能力此刻能不能提交 (2026-10-21)。
   *
   * 后端对「本地没有实现」的能力 (创意生图 / 局部重绘 / 图片翻译 / 自由创作)
   * 是 **没通道就判失败并退款**, 不存在本地产出。故这些页在按钮上方如实说明,
   * 并把提交置灰 —— 否则用户点下去只会等到一次 42204。
   * 有真实本地算法的能力此时是 local, 不在拦截范围。
   */
  const { data: capsData } = useCapabilities();
  const { token } = useAuth();
  const runtime = capsData?.items.find((c) => c.id === props.capability)?.runtime;
  const unavailableReason =
    runtime && (runtime.effective === 'unavailable' || runtime.effective === 'disabled')
      ? runtime.reason || '该能力当前不可提交，请稍后再试或联系客服。'
      : null;
  /*
   * 只拦**已登录**用户的提交。访客点击仍要走登录弹窗（上传/提交接口的
   * 401 → auth:required 契约）；把按钮对访客一起置灰，会让他在登录前
   * 连「为什么不能用」的入口都点不到。
   */
  const blocked = Boolean(token) && Boolean(unavailableReason);
  const {
    capability,
    title,
    desc,
    upload,
    settings,
    submitLabel,
    creditLabel,
    hint,
    emptyDesc,
    children,
    formValid,
    submitting,
    result,
    resultTag,
    onSubmit,
    onSettingsChange,
    resultActions,
    resultCompare,
    resultPane,
    sourcePane,
    trailingPane,
  } = props;

  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<ToolAsset[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [trailingCollapsed, setTrailingCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ratio, setRatio] = useState(settings?.defaultRatio ?? 'original');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** 手机上传弹窗 (二维码方案, 手机端传回后进入图片位) */
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * 图片位的同步镜像。
   *
   * 素材库弹窗「确定」时是**同步 for 循环**逐个调 onPick, 期间不会重渲染 ——
   * 只读 `images` 会让「最多 1 张」的页面把一次勾选的 3 张全部收下 (每张都读到
   * 同一份旧 state)。故用 ref 记下本轮已接受的结果, 渲染后再与 state 对齐。
   */
  const imagesRef = useRef<ToolAsset[]>(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  /**
   * 素材库点选回填。
   *
   * ⚠️ 拒绝时必须显式 `return false`: undefined 会被选择器当成「接受」,
   * 上限与去重就形同虚设 (AssetLibraryModal 的调用约定)。
   */
  const pickFromLibrary = useCallback(
    (asset: Asset): boolean => {
      if (!upload) return false;
      const current = imagesRef.current;
      if (current.length >= upload.max) {
        message.warning(`最多上传 ${upload.max} 张图片`);
        return false;
      }
      if (current.some((x) => x.id === asset.id)) {
        message.info('该素材已在列表中');
        return false;
      }
      const next: ToolAsset = {
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: asset.sourceUrl.split('/').pop() ?? '素材',
      };
      imagesRef.current = [...current, next];
      // 用 updater 追加: 一轮多选时前一张还没进 state, 直接读 images 会丢
      setImages((prev) => (prev.some((x) => x.id === next.id) ? prev : [...prev, next]));
      return true;
    },
    [message, upload],
  );

  // 素材库弹窗 (通用组件; 本页只提供额度与去重规则)
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
  } = useAssetLibrary(pickFromLibrary);

  /**
   * 手机端传回图片 → 进入图片位。
   *
   * 超出位数的部分**如实告知被截断**, 不静默丢弃: 用户在手机上挑好了 5 张,
   * 电脑端只进 1 张却不说, 是最难受的一种失败。
   */
  const addMobileAssets = useCallback(
    (assets: MobileUploadAsset[]) => {
      const max = upload?.max ?? 0;
      const prev = imagesRef.current;
      const room = max - prev.length;
      if (room <= 0) {
        message.warning(`图片位已满 (${max} 张), 手机上传的图片未加入`);
        setMobileOpen(false);
        return;
      }
      const fresh = assets.filter((a) => !prev.some((x) => x.id === a.id));
      const accepted = fresh.slice(0, room);
      const dropped = fresh.length - accepted.length;
      if (dropped > 0) message.warning(`图片位只剩 ${room} 个, ${dropped} 张未加入`);

      const added: ToolAsset[] = accepted.map((a) => ({
        id: a.id,
        url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
        name: a.filename,
      }));
      imagesRef.current = [...prev, ...added];
      setImages((cur) => [...cur, ...added.filter((a) => !cur.some((x) => x.id === a.id))]);
      setMobileOpen(false);
      if (added.length > 0) message.success(`已从手机接收 ${added.length} 张图片`);
    },
    [message, upload],
  );

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
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
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
    // 能力不可提交 (未接通道 / 已下线): 不发这次注定 42204 的请求
    if (blocked) {
      message.warning(unavailableReason || '该能力当前不可提交');
      return;
    }
    await onSubmit(images, { ratio, resolution });
  };

  const results: ToolResult[] = result === null ? [] : Array.isArray(result) ? result : [result];
  const showResult = results.length > 0;
  const lightboxItems = results
    .filter((item) => item.status === 'succeeded' && item.url && item.modality !== 'video')
    .map((item) => ({
      id: item.url!,
      url: item.url!,
      width: item.width,
      height: item.height,
    }));
  const lightboxIndex = lightboxUrl ? lightboxItems.findIndex((item) => item.url === lightboxUrl) : -1;

  return (
    <div
      className={`pk-workspace${trailingPane ? ' pk-workspace-trailing' : ''}${
        trailingPane && trailingCollapsed ? ' pk-workspace-trailing-collapsed' : ''
      }`}
    >
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
                        onClick={openLibrary}
                      >
                        从素材库导入
                      </button>
                      <button
                        type="button"
                        className="pk-text-link"
                        title="用手机扫码上传，图片回填到左侧"
                        onClick={() => setMobileOpen(true)}
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

            {/* 业务卡 (函数形态可读到已上传图片, 供画布类页面当底图) */}
            {typeof children === 'function' ? children(images) : children}

          </div>

          {/* 提交区 (sticky 底部) */}
          {/*
            能力不可提交时先说明再置灰 (2026-10-21)。
            这些页(局部重绘/图片翻译/创意生图…)不做能力级判断, 而后端对
            「本地没有实现」的能力会没通道就 failed/42204 —— 与其让用户
            点下去等一次失败, 不如在这里说清原因。有真实本地算法的能力
            (抠图/扩图/换色/去水印…)此时是 local, 不受影响。
          */}
          {blocked && unavailableReason && !submitting && (
            <p className="tool-submit-notice tool-submit-notice-error">{unavailableReason}</p>
          )}
          <ToolSubmitBar
            submitting={submitting}
            disabled={!formValid || blocked}
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
                  onRatioChange={(next) => {
                    setRatio(next);
                    onSettingsChange?.({ ratio: next, resolution });
                  }}
                  resolution={resolution}
                  onResolutionChange={(next) => {
                    setResolution(next);
                    onSettingsChange?.({ ratio, resolution: next });
                  }}
                  capabilityId={capability}
                  showRatio={Boolean(settings.ratio)}
                  showResolution={Boolean(settings.resolution)}
                />
              ) : null
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 (页面可注入共享结果网格) ── */}
      {resultPane ?? (
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
          (sourcePane
            ? typeof sourcePane === 'function'
              ? sourcePane(images)
              : sourcePane
            : null) ?? (
            <ToolEmptyState title={title} desc={emptyDesc} capability={capability} />
          )
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
                        {resultCompare && results.length === 1 ? (
                          <ImageCompare
                            beforeUrl={resultCompare.beforeUrl}
                            afterUrl={r.url}
                            beforeLabel={resultCompare.beforeLabel}
                            afterLabel={resultCompare.afterLabel}
                          />
                        ) : r.modality === 'video' ? (
                          <ResultMedia url={r.url} modality={r.modality} alt={`${title}结果 ${i + 1}`} />
                        ) : (
                          <button
                            type="button"
                            className="pk-result-preview"
                            aria-label={`预览${title}结果 ${i + 1}`}
                            onClick={() => setLightboxUrl(r.url!)}
                          >
                            <ResultMedia url={r.url} modality={r.modality} alt={`${title}结果 ${i + 1}`} />
                          </button>
                        )}
                      </div>
                      <div className="pk-result-meta">
                        <span className="pk-result-variant">
                          {title}结果
                          {/* 真实模型 / 本地回落必须区分显示, 不按能力 mode 猜 */}
                          <ProviderBadge provider={r.provider} />
                        </span>
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
                        <span>生成失败：{taskErrorText(r.errorCode)}</span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {/* ── 右: 附加栏 (局部重绘历史记录; 其他页面不传则为空) ── */}
      {trailingPane && (
        <ToolTrailingContext.Provider
          value={{ collapsed: trailingCollapsed, toggle: () => setTrailingCollapsed((value) => !value) }}
        >
          {trailingPane}
        </ToolTrailingContext.Provider>
      )}

      {lightboxIndex >= 0 && (
        <ImageLightbox
          items={lightboxItems}
          index={lightboxIndex}
          onIndexChange={(index) => setLightboxUrl(lightboxItems[index]?.url ?? null)}
          onClose={() => setLightboxUrl(null)}
        />
      )}

      {/* 素材库选择弹窗 (真实数据; 可选张数 = 剩余图片位) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pickFromLibrary}
        maxSelectable={upload ? Math.max(upload.max - images.length, 0) : undefined}
      />

      {/* 手机上传弹窗 (二维码方案) */}
      <MobileUploadModal
        open={mobileOpen}
        onReceived={addMobileAssets}
        onCancel={() => setMobileOpen(false)}
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
