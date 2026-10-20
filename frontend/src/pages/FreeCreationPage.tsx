import { useCallback, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { ChevronLeft, ChevronRight, ImagePlus, Maximize2, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { assetsApi, generateApi, toAbsoluteUrl } from '../lib/api';

import { ToolEmptyState, ToolGeneratingState } from '../components/ToolEmptyState';
import { ToolSubmitBar } from '../components/ToolSubmitBar';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { ToolSettingsPopover } from '../components/ToolSettingsPopover';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { PromptPolishModal } from '../components/PromptPolishModal';
import { ImageToPromptModal } from '../components/ImageToPromptModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { useAuth } from '../context/AuthContext';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { pollToResult } from '../lib/poll';
import type { Asset, MobileUploadAsset, TaskStatus } from '../types/api';

/**
 * 自由创作工作台 —— 1:1 复刻参考站 https://ijihua.cn/free-creation。
 *
 * 版面数值来自参考站 computed styles 实拍 (1920×1080):
 *   布局与 product-kit/viral-clone 同构: page padding 16; layout grid 432px+1fr gap16;
 *   输入栏 432 (form-scroll gap 10, 底部 actions margin-top auto 推底); 结果栏白底 radius16
 *   上传参考图: 标题行 (从素材库导入/手机上传/计数器 0/4, 标题无必填星号 = 选填);
 *              空态 dropzone 400x160 虚线 #E5E7EF/#F2F4F7 radius8 padding16,
 *              prompt 366x126 (img 14x14 margin-bottom 20, span 14px/22 #1D2129,
 *              small 12px/20 #86909C); 有图后 ready 态: 去边框底色, thumb-grid
 *              repeat(auto-fill,80px) gap10, thumb 80x80 radius8, add-card 80x80,
 *              排序箭头 18x18 圆形 rgba(29,33,41,.66), sort-tip 11px #86909C
 *   创作提示词: label 行 (span 14px/700 #333 lh13, ::before "*" #EB5757 必填;
 *              工具按钮 12px #5546D8 h16 gap4, 组 gap12: AI润色/图片转提示词, 图标 13x13);
 *              textarea 400x80 rows8 maxlength4000 padding 5px 36px 5px 12px radius4
 *              border #E5E7EF 14px/22 #333 resize vertical + 放大编辑按钮
 *   高级设置: summary 400x34 白底 (开启时上圆角 9px 9px 6px 6px) padding 0 12px
 *             11px #687182; chip 白底 border #E4E7EF radius5 h28 padding 0 9px 11px #48505E;
 *             popover 带头部 (h2 16px/20 #292839 + close 24x24 #526077) bottom calc(100%+8px)
 *             radius16 padding 17px 16px shadow rgba(61,66,86,.2) 0 8px 24px;
 *             比例 4 列 gap10 option 84.5x39 (激活 #F1EFFF/#5D47EA);
 *             分辨率 3 列 option 116x62 (strong 13px/500, span 11px)
 *   提交区: actions flex column gap16 margin-top auto; primary 400x40 radius8 渐变
 *           (2026-10-19 移除 secondary「重置」/「清空结果」行 —— 用户要求不要, 且实测在 900 高
 *            视口下溢出首屏)
 *   窄屏: section-head 显示 (span 14px/700 #333 lh13 + h1 16px/700 #333 lh22 margin-top 8);
 *         actions 变 1 列 bg #F6F7FB padding 12px 16px 0 gap8, 按钮 100% 宽
 *   结果栏: 空态 160x160 插画 + h3 14px/700 #333 + p 12px #86909C
 *
 * 接线: 参考图 (0~4 张, 顺序保留) + 提示词 → free_create 任务 (参考图为选填,
 * 后端 inputs=0 不强制张数); 比例/画质 → ratio / size 参数; 张数与顺序直达 provider
 * (顶部条带横排参考图, 真实参与构图)。
 *
 * 产出来源如实披露 (2026-10-20): 结果卡徽标按**每单真实的 task.provider** 显示,
 * 不再硬编码「本地占位渲染」——
 *   gateway → 绿徽标「真实模型」; local → 琥珀徽标「本地算法」(网关不可用已回落)。
 * 同一能力在两条通道下产出不同, 界面据实区分, 不用假效果冒充模型能力。
 * 徽标取色: .pk-result-source-gateway 用成功色, .pk-result-source-local 用警示色。
 *空态说明改为中性描述 —— 用户尚未提交时无 provider 可言, 不预告通道结论。
 *
 * AI润色/图片转提示词仍未接入语言/视觉模型, 点击如实提示。
 * 4K 超出本地算法上限如实禁用 (参考站为积分倍率制, 本站无积分账户故不显示"倍消耗")。
 *
 * 提交按钮登录墙 (2026-10-19, 对齐参考站该页):
 *   未登录 → 主文案「登录免费生成」, 不显示积分角标, 点击唤起登录弹窗 (ToolSubmitBar 内部判定
 *   useAuth().token), 登录后停在原页不跳转;
 *   已登录 → 主文案「立即生成」+ 角标「本次消耗 10 积分」(10 积分/张 与 AuthCard 文案同口径);
 *   提示词为空时按钮 disabled 且视觉置灰 (opacity .55 + not-allowed, 曾被 .fc-actions 覆盖成
 *   opacity 1 导致看不出禁用, 已修正)。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_REF_IMAGES = 4;
const MAX_IMAGE_MB = 10;
const MAX_PROMPT_LEN = 4000;

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
  /** 产出来源: gateway=真实模型 / local=本地算法回落 / null=未知 */
  provider?: string | null;
}

/**
 * 产出来源 → 徽标文案与样式。
 *
 * 按**这一单实际走的通道**显示, 不按能力清单的静态 mode 猜:
 *   gateway → 「真实模型」(绿)  模型真出图
 *   local   → 「本地算法」(琥珀) 网关不可用已回落, 仍是本地算法不是模型结果
 *   null    → 「来源未知」(琥珀) 任务未落provider 字段, 不猜测
 *
 * 这是诚实披露的落点: 网关接通后徽标自动变绿, 网关故障变琥珀,
 * 两种情况都不把本地算法的产出说成模型结果。
 */
function sourceBadge(provider?: string | null): { text: string; cls: string } {
  if (provider === 'gateway') return { text: '真实模型', cls: 'pk-result-source-gateway' };
  if (provider === 'local') return { text: '本地算法', cls: 'pk-result-source-local' };
  return { text: '来源未知', cls: 'pk-result-source-local' };
}

export function FreeCreationPage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { token, openLogin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 消耗价读后端下发的 creditCost, 不再在本页写死「10 积分」
  const creditLabel = useCreditLabel('free_create');

  // ── 表单状态 ──
  const [images, setImages] = useState<PkAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);
  const [polishOpen, setPolishOpen] = useState(false);
  const [i2pOpen, setI2pOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PkResult | null>(null);
  const pollSignal = usePollAbort();

  // 参考站该页: 参考图选填 (标题无必填星号), 提示词必填 (label ::before 星)
  const formValid = prompt.trim().length > 0;

  // ── 上传: 参考图 (点击/拖拽/粘贴, 最多 4 张, 顺序保留) ──
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        message.warning('请选择图片文件（PNG / JPG / WebP / GIF）');
        return;
      }
      const room = MAX_REF_IMAGES - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${MAX_REF_IMAGES} 张参考图片`);
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
        message.success(`已上传 ${uploaded.length} 张参考图片`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [images.length, ensureProject, message],
  );

  const removeImage = (id: string) => setImages((prev) => prev.filter((x) => x.id !== id));

  /** 调整参考图顺序 (参考站缩略图左右箭头; 边界禁用) */
  const moveImage = (index: number, dir: -1 | 1) => {
    setImages((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // 拖拽 & 粘贴 (本页唯一上传区即参考图区, 粘贴直接进参考图)
  const [dragging, setDragging] = useState(false);
  usePasteUpload(uploadFiles);

  // ── 素材库导入 (真实数据) ──
  //
  // ⚠️ **必须返回 false 表示拒绝** (不是 undefined):
  // 素材库选择器是**多选**的, 「确定」时逐个调用本函数;
  // 只有显式返回 false 才能让选择器知道"这张没进", 从而中止整批并保持弹窗打开。
  // 返回 undefined 会被当成"接受" —— 超额的那张会静默进入, 上限失效。
  const pickFromLibrary = (asset: Asset): boolean => {
    if (images.length >= MAX_REF_IMAGES) {
      message.warning(`最多上传 ${MAX_REF_IMAGES} 张参考图片`);
      return false;
    }
    if (images.some((x) => x.id === asset.id)) {
      message.info('该素材已在列表中');
      return false;
    }
    setImages((prev) => [
      ...prev,
      { id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name: asset.sourceUrl.split('/').pop() ?? '素材' },
    ]);
    return true;
  };

  // 素材库弹窗 (通用组件, 2026-10-19 抽取; 各页只提供点选回填逻辑)
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
  } = useAssetLibrary(pickFromLibrary);

  // ── AI润色 / 图片转提示词 / 手机上传: 三个真实入口 (2026-10-20) ──
  //
  // 均需登录 (参考站实拍: 未登录点这些按钮先弹登录框)。
  // 路由已对外开放, 故未登录时调 openLogin() 而不是跳登录页。
  const requireLogin = (): boolean => {
    if (token) return true;
    openLogin();
    return false;
  };

  const runPolish = () => {
    if (!requireLogin()) return;
    if (!prompt.trim()) {
      message.warning('请先输入创作提示词');
      return;
    }
    setPolishOpen(true);
  };

  const runImageToPrompt = () => {
    if (!requireLogin()) return;
    setI2pOpen(true);
  };

  const runMobileUpload = () => {
    if (!requireLogin()) return;
    setMobileOpen(true);
  };

  /**
   * 手机端传回图片 → 进入参考图位 (与网页上传同构, 走同一份图片数组)。
   *
   * 支持一次多张 (参考站手机端可多选), **顺序即构图顺序** ——
   * 手机端排的序就是电脑端参考图位的先后。
   *
   * ⚠️ 超出位数的部分**如实告知被截断**, 不静默丢弃:
   * 用户在手机上精心排了 5 张, 电脑端只进 2 张却不说, 是最难受的一种失败。
   */
  const addMobileAssets = useCallback(
    (assets: MobileUploadAsset[]) => {
      setImages((prev) => {
        const room = MAX_REF_IMAGES - prev.length;
        if (room <= 0) {
          message.warning(`参考图位已满 (${MAX_REF_IMAGES} 张), 手机上传的图片未加入`);
          return prev;
        }
        const fresh = assets.filter((a) => !prev.some((x) => x.id === a.id));
        const accepted = fresh.slice(0, room);
        const dropped = fresh.length - accepted.length;
        if (dropped > 0) {
          message.warning(`参考图位只剩 ${room} 个, ${dropped} 张未加入`);
        }
        return [
          ...prev,
          ...accepted.map((a) => ({
            id: a.id,
            url: toAbsoluteUrl(a.url) ?? '',
            name: a.filename,
          })),
        ];
      });
      setMobileOpen(false);
      message.success(`已从手机接收 ${assets.length} 张图片`);
    },
    [message],
  );

  // ── 生成 ──
  const pollTask = useCallback(
    (taskId: string) => pollToResult(taskId, { signal: pollSignal }),
    [pollSignal],
  );

  const submit = async () => {
    if (!formValid || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        capability: 'free_create',
        // 参考图选填 0~4 张; 顺序即构图顺序 (provider 顶部条带按序横排)
        inputAssetIds: images.map((x) => x.id),
        params: {
          prompt: prompt.trim(),
          ratio,
          size: resolution,
        },
      });
      const done = await pollTask(taskId);
      setResult(done);
      if (done.status === 'failed') message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
      else message.success('创作图已生成');
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
          {/* 窄屏标题头 (桌面 display:none 实拍确认) */}
          <div className="fc-section-head">
            <span>创意生图</span>
            <h1>输入提示词，直接生成图片</h1>
          </div>

          <div className="pk-form-scroll">
            <section className="pk-config-card">
              {/* 上传参考图 (选填, 无必填星号) */}
              <div className="pk-section">
                <div className="pk-upload-title-row">
                  <strong className="pk-section-title">上传参考图</strong>
                  <div className="pk-upload-title-actions">
                    <button
                      type="button"
                      className="pk-text-link"
                      onClick={() => {
                        // 素材库内容是登录用户的私有数据, 未登录时先弹登录框
                        // (参考站该按钮在未登录态是 disabled, 本项目路由已对外开放,
                        //  故改为点按弹登录框, 登录后停在原页)
                        if (!requireLogin()) return;
                        openLibrary();
                      }}
                    >
                      从素材库导入
                    </button>
                    <button
                      type="button"
                      className="pk-text-link"
                      title="扫码在手机上选择图片，接收后自动进入参考图位"
                      onClick={runMobileUpload}
                    >
                      手机上传
                    </button>
                    <span className="pk-upload-count">
                      {images.length}/{MAX_REF_IMAGES}
                    </span>
                  </div>
                </div>

                <div
                  className={`pk-dropzone fc-dropzone${dragging ? ' pk-dropzone-dragging' : ''}${images.length > 0 ? ' fc-dropzone-ready' : ''}`}
                  onClick={() => images.length < MAX_REF_IMAGES && fileInputRef.current?.click()}
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
                    <label className="pk-upload-prompt fc-upload-prompt">
                      <ImagePlus size={14} />
                      <span>点击、拖拽或粘贴参考图片到此处上传</span>
                      <small>最多可上传 {MAX_REF_IMAGES} 张参考图片，单张不超过 {MAX_IMAGE_MB}MB</small>
                    </label>
                  ) : (
                    <>
                      <div className="fc-thumb-grid">
                        {images.map((img, i) => (
                          <div key={img.id} className="fc-thumb">
                            <img src={img.url} alt={img.name} loading="lazy" decoding="async" />
                            <div className="fc-thumb-order">
                              <button
                                type="button"
                                aria-label={`前移 ${img.name}`}
                                disabled={i === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveImage(i, -1);
                                }}
                              >
                                <ChevronLeft size={12} />
                              </button>
                              <button
                                type="button"
                                aria-label={`后移 ${img.name}`}
                                disabled={i === images.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveImage(i, 1);
                                }}
                              >
                                <ChevronRight size={12} />
                              </button>
                            </div>
                            <button
                              type="button"
                              className="fc-thumb-remove"
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
                        {images.length < MAX_REF_IMAGES && (
                          <button
                            type="button"
                            className="fc-thumb-add"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                          >
                            <Plus size={18} />
                            <span>添加</span>
                          </button>
                        )}
                      </div>
                      <p className="fc-sort-tip">使用箭头调整参考图顺序，顺序会影响生成构图</p>
                    </>
                  )}
                </div>
              </div>

              {/* 创作提示词 (必填) */}
              <div className="pk-section fc-prompt-field">
                <div className="fc-prompt-label-row">
                  <span>创作提示词</span>
                  <div className="fc-prompt-tools">
                    <button type="button" className="fc-prompt-tool-btn" title="AI 优化当前创作提示词" onClick={runPolish}>
                      <Sparkles size={13} />
                      <span>AI润色</span>
                    </button>
                    <button type="button" className="fc-prompt-tool-btn" title="上传图片，AI 反推创作提示词" onClick={runImageToPrompt}>
                      <Sparkles size={13} />
                      <span>图片转提示词</span>
                    </button>
                  </div>
                </div>
                <div className="pk-desc-editor">
                  <textarea
                    className="fc-prompt-textarea"
                    rows={8}
                    maxLength={MAX_PROMPT_LEN}
                    value={prompt}
                    placeholder="例如：把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感"
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pk-desc-expand"
                    aria-label="放大编辑创作提示词"
                    title="编辑"
                    onClick={() => setExpandOpen(true)}
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* 高级设置 + 提交 (sticky 底部) */}
          <div className="fc-actions">
            <ToolSubmitBar
              submitting={submitting}
              disabled={!formValid}
              label="立即生成"
              guestLabel="登录免费生成"
              creditLabel={creditLabel ?? undefined}
              settings={
                <ToolSettingsPopover
                  open={settingsOpen}
                  onToggle={() => setSettingsOpen((v) => !v)}
                  ratio={ratio}
                  onRatioChange={setRatio}
                  resolution={resolution}
                  onResolutionChange={setResolution}
                  popoverClassName="fc-settings-popover"
                  popoverRole="dialog"
                  popoverAriaLabel="高级设置"
                  header={
                    <div className="fc-settings-popover-head">
                      <h2>高级设置</h2>
                      <button
                        type="button"
                        className="fc-settings-close"
                        aria-label="关闭高级设置"
                        title="关闭"
                        onClick={() => setSettingsOpen(false)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  }
                />
              }
              onSubmit={() => void submit()}
            />
          </div>
        </div>
      </aside>

      {/* ── 右: 结果栏 ── */}
      <section className="pk-result-pane">
        {submitting && !result ? (
          /* 生成中 → 骨架占位, 不退回空态 (见 ToolGeneratingState 注释) */
          <ToolGeneratingState />
        ) : !result ? (
          <ToolEmptyState title="效果图预览" desc="提交任务后，生成结果将在此处展示">
            <p className="vc-mock-note">
              参考图与提示词会一并送入生成通道；结果卡上的徽标会如实标明本次产出来自真实模型还是本地算法
            </p>
          </ToolEmptyState>
        ) : (
          <div className="pk-result-body">
            <div className="pk-result-toolbar">
              <div className="pk-result-title">
                生成结果
                <span className="pk-result-count">{images.length} 张参考</span>
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
                    <img src={result.url} alt="自由创作图" />
                  </div>
                  <div className="pk-result-meta">
                    <span className="pk-result-variant">
                      自由创作结果
                      <span className={`pk-result-source ${sourceBadge(result.provider).cls}`}>
                        {sourceBadge(result.provider).text}
                      </span>
                    </span>
                    <span className="pk-result-params">
                      {ratio} · {resolution.toUpperCase()}
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

      {/* 素材库选择弹窗 (真实数据; 多选, 上限与参考图位一致) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pickFromLibrary}
        maxSelectable={MAX_REF_IMAGES}
      />

      {/* AI润色弹窗 (1:1 复刻参考站) —— 应用后回填主提示词框 */}
      <PromptPolishModal
        open={polishOpen}
        value={prompt}
        onApply={(text) => {
          setPrompt(text);
          setPolishOpen(false);
          message.success('润色结果已应用');
        }}
        onCancel={() => setPolishOpen(false)}
      />

      {/* 图片转提示词弹窗 (1:1 复刻参考站) */}
      <ImageToPromptModal
        open={i2pOpen}
        onApply={(text) => {
          setPrompt(text);
          setI2pOpen(false);
          message.success('解析结果已应用');
        }}
        onCancel={() => setI2pOpen(false)}
      />

      {/* 手机上传弹窗 (二维码方案) —— 手机端传回后进入参考图位 */}
      <MobileUploadModal open={mobileOpen} onReceived={addMobileAssets} onCancel={() => setMobileOpen(false)} />

      {/* 创作提示词放大编辑 */}
      <Modal
        open={expandOpen}
        title="编辑创作提示词"
        okText="确定"
        cancelText="取消"
        onOk={() => setExpandOpen(false)}
        onCancel={() => setExpandOpen(false)}
      >
        <textarea
          className="pk-expand-textarea"
          rows={10}
          maxLength={MAX_PROMPT_LEN}
          value={prompt}
          placeholder="例如：把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Modal>
    </div>
  );
}
