import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { ChevronLeft, ChevronRight, ImagePlus, Maximize2, Plus, Sparkles, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { assetSrc, assetsApi, generateApi, toAbsoluteUrl } from '../lib/api';

import { ToolSubmitBar } from '../components/ToolSubmitBar';
import { ResultGalleryPane } from '../components/ResultGalleryPane';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { useResultGallery, type GalleryItem } from '../hooks/useResultGallery';
import { ToolSettingsPopover } from '../components/ToolSettingsPopover';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { PromptPolishModal } from '../components/PromptPolishModal';
import { ImageToPromptModal } from '../components/ImageToPromptModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { useAuth } from '../context/AuthContext';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useGenerateError } from '../hooks/useGenerateError';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { pollToResult } from '../lib/poll';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
  taskErrorText,
} from '../lib/constants';
import { useCapabilities } from '../hooks/useCapabilities';
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
 *           (不设 secondary「重置」/「清空结果」行: 900 高视口下会溢出首屏)
 *   窄屏: section-head 显示 (span 14px/700 #333 lh13 + h1 16px/700 #333 lh22 margin-top 8);
 *         actions 变 1 列 bg #F6F7FB padding 12px 16px 0 gap8, 按钮 100% 宽
 *   结果栏: 空态 160x160 插画 + h3 14px/700 #333 + p 12px #86909C
 *
 * 结果栏展示「全部生成图」: 本页能力 (free_create) 全部成功产出的网格,
 * 数据取自 /tasks。
 * 新图由轮询结果**当场插入榜首** (不重拉列表, 避免占位撤下后旧图回弹的闪烁);
 * 点缩略图开大图预览 (原始比例 + 下载原图)。
 *
 * 接线: 参考图 (0~4 张, 顺序保留) + 提示词 → free_create 任务 (参考图为选填,
 * 后端 inputs=0 不强制张数); 比例/画质 → ratio / size 参数; 张数与顺序直达 provider
 * (顶部条带横排参考图, 真实参与构图)。
 *
 * 产出来源不向用户展示: 创作统一走 API 调用模型, 界面不标
 * 历史本地产出标签已停用；新任务只显示真实模型来源。
 *
 * 没通道就失败: free_create 只允许模型生成。后端无可用模型通道时任务按 42204 失败并退款;
 * 本页据此在 /capabilities 报 unavailable 时直接禁用提交并写明原因 ——
 * 不让用户点下去才失败, 也不交付任何冒充创作结果的东西。
 *
 * AI润色/图片转提示词走文本通道; 文本通道未配置时
 * 后端 502, 界面如实报错, 不编造润色结果。
 * 4K 只有云端通道能兑现: 选不了时由 lib/optionSets 置灰并说明 (参考站为积分倍率制,
 * 本站无积分账户故不显示"倍消耗")。
 *
 * 提交按钮登录墙 (对齐参考站该页):
 *   未登录 → 主文案「登录免费生成」, 不显示积分角标, 点击唤起登录弹窗 (ToolSubmitBar 内部判定
 *   useAuth().token), 登录后停在原页不跳转;
 *   已登录 → 主文案「立即生成」+ 角标「本次消耗 10 积分」(10 积分/张 与 AuthCard 文案同口径);
 *   提示词为空时按钮 disabled 且视觉置灰 (opacity .55 + not-allowed)。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_REF_IMAGES = 4;
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
}

export function FreeCreationPage() {
  const { message, modal } = App.useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token, openLogin } = useAuth();
  const [searchParams] = useSearchParams();
  // 创意生图与自由创作共用参考站的 /free-creation 页面，但提交的任务能力不同。
  // 只接受两个白名单值，未知参数回落到本页默认的自由创作，避免把任意串透传给后端。
  const capability =
    searchParams.get('capability') === 'creative_image' ? 'creative_image' : 'free_create';
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 消耗价读后端下发的 creditCost, 不再在本页写死「10 积分」
  const creditLabel = useCreditLabel(capability);

  // ── 表单状态 ──
  const [images, setImages] = useState<PkAsset[]>([]);
  /**
   * 参考图位的同步镜像。
   *
   * 素材库「确定」是同步 for 循环逐个调 onPick, 期间不重渲染 —— 只读 state
   * 会让一次勾选超过剩余位数的图全部进列表 (每张都读到同一份旧值)。
   */
  const imagesRef = useRef<PkAsset[]>(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
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

  // ── 右侧「全部生成图」(本页能力的历史产出) ──
  // 数据取自 /tasks 而非 /assets: 生成记录以任务为准 (创作时间、尺寸口径都在任务上)。
  // 网格/大图/右键菜单由 components/ResultGalleryPane 渲染 (与商品主图页共用)。
  const gallery = useResultGallery({ capability, token });
  // 服务端仍有 running/pending 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢
  const generating = submitting || gallery.items.some((item) => !item.url);

  // 参考站该页: 参考图选填 (标题无必填星号), 提示词必填 (label ::before 星)
  const formValid = prompt.trim().length > 0;

  /*
   * 运行时可用性: 本能力本地没有实现, 没有云端模型通道时
   * 后端一定会判失败并退款。与其让用户等一次注定失败的任务, 不如提前拦住并说明原因。
   * 只在后端明确报 unavailable/disabled 时拦 —— 清单还没加载完 (或加载失败) 不拦,
   * 否则一次网络抖动就会让整页不可用。
   */
  const { data: capData } = useCapabilities();
  const freeCreateRuntime = capData?.items.find((c) => c.id === capability)?.runtime;
  const unavailableReason =
    freeCreateRuntime &&
    (freeCreateRuntime.effective === 'unavailable' || freeCreateRuntime.effective === 'disabled')
      ? freeCreateRuntime.reason || '该能力当前不可提交，请稍后再试或联系客服。'
      : null;

  // ── 上传: 参考图 (点击/拖拽/粘贴, 最多 4 张, 顺序保留) ──
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
        return;
      }
      const room = MAX_REF_IMAGES - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${MAX_REF_IMAGES} 张参考图片`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      const oversize = accepted.filter((f) => f.size > MAX_IMAGE_BYTES);
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
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
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
    const current = imagesRef.current;
    if (current.length >= MAX_REF_IMAGES) {
      message.warning(`最多上传 ${MAX_REF_IMAGES} 张参考图片`);
      return false;
    }
    if (current.some((x) => x.id === asset.id)) {
      message.info('该素材已在列表中');
      return false;
    }
    const next: PkAsset = {
      id: asset.id,
      url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
      name: asset.sourceUrl.split('/').pop() ?? '素材',
    };
    imagesRef.current = [...current, next];
    setImages((prev) => (prev.some((x) => x.id === next.id) ? prev : [...prev, next]));
    return true;
  };

  // 素材库弹窗 (通用组件; 各页只提供点选回填逻辑)
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
  } = useAssetLibrary(pickFromLibrary);

  // ── AI润色 / 图片转提示词 / 手机上传: 三个真实入口 ──
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
            url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
            name: a.filename,
          })),
        ];
      });
      setMobileOpen(false);
      message.success(`已从手机接收 ${assets.length} 张图片`);
    },
    [message],
  );

  // ── 结果图右键操作 ──
  //
  // 「查看大图 / 复制地址 / 下载 / 删除」由 ResultGalleryPane 提供, 本页只补
  // 本页独有的「用作参考图」与删除时的连带清理 —— 每个动作都用已有接口与状态,
  // 不新增后端能力。

  /** 把这张生成图放进左侧参考图位 */
  const useAsReference = (item: GalleryItem) => {
    const assetId = item.assetId;
    if (images.length >= MAX_REF_IMAGES) {
      message.warning(`最多上传 ${MAX_REF_IMAGES} 张参考图片`);
      return;
    }
    if (!assetId) {
      // 任务还在但素材已被清理 (后台删过素材): 不能拿一个空 id 去提交
      message.error('这张图片的素材已不存在，无法用作参考图');
      return;
    }
    if (images.some((x) => x.id === assetId)) {
      message.info('该图片已在参考图位');
      return;
    }
    setImages((prev) => [...prev, { id: assetId, url: item.url, name: `生成图-${item.id.slice(-6)}` }]);
    message.success('已加入参考图位，下一轮生成会带上它');
  };

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
          /*
           * 产出素材随之被删, 若它已被「用作参考图」放进左侧参考图位,
           * 必须同步摘掉 —— 否则下一次生成会带着一个已不存在的 assetId 提交。
           */
          if (item.assetId) setImages((prev) => prev.filter((x) => x.id !== item.assetId));
          message.success('已删除作品及其生成图');
        } catch (e) {
          message.error((e as Error).message || '删除失败');
        }
      },
    });
  };

  // ── 生成 ──
  const pollTask = useCallback(
    (taskId: string) => pollToResult(taskId, { signal: pollSignal }),
    [pollSignal],
  );

  const submit = async () => {
    if (!formValid || generating) return;
    // 没有可用模型通道: 后端必定 42204 并退款, 不发起这次注定失败的任务
    if (unavailableReason) {
      message.warning(unavailableReason);
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        capability,
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
      /*
       * 新图**直接插到列表首位**, 不再回头重拉列表。
       *
       * 重拉会等一次网络往返: 占位卡已撤、新图还没到, 网格先缩回旧图再弹回新图 ——
       * 正是用户看到的「切换出图闪烁」。这里用轮询结果当场替换占位,
       * 与 setSubmitting(false) 同一批提交, 占位卡与新图卡在同一帧交接。
       * 列表以本页状态为准, 需要对齐服务端时用手动「刷新」。
       */
      if (done.status === 'succeeded' && done.url) {
        gallery.prepend([
          {
            id: taskId,
            url: done.url,
            width: done.width ?? null,
            height: done.height ?? null,
            createdAt: new Date().toISOString(),
            prompt: prompt.trim(),
          },
        ]);
      } else if (done.status === 'failed') {
        message.error(`生成失败：${taskErrorText(done.errorCode)}`);
      } else {
        message.success('创作图已生成');
      }
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  return (
    <div className="pk-workspace fc-workspace">
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
              <div className="pk-section fc-upload-section">
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
                    accept={SUPPORTED_IMAGE_ACCEPT}
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
            {/* 无可用模型通道: 提前说明, 而不是让用户点下去等一次 42204 */}
            {unavailableReason && !generating && (
              <p className="tool-submit-notice tool-submit-notice-error">{unavailableReason}</p>
            )}
            <ToolSubmitBar
              submitting={generating}
              /*
               * 不可用的置灰**只对已登录生效**: guest 点按钮的职责是弹登录框
               * (见 free-creation-submit.spec.ts 的登录墙契约), 置灰会把它挡掉。
               * 已登录时置灰 + 上方说明, 避免发起一次注定 42204 的请求。
               */
              disabled={!formValid || (Boolean(token) && Boolean(unavailableReason))}
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
                  capabilityId={capability}
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

      {/* ── 右: 结果栏 (本页全部生成图) ──
          网格展示本页能力的全部成功产出; 网格/大图/右键菜单由
          components/ResultGalleryPane 渲染, 与商品主图页共用同一套展示
          (两页只在「额外动作」与连带清理上不同)。 */}
      <ResultGalleryPane
        title={generating ? '生成中…' : '全部生成图'}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        notice={
          result?.status === 'failed' ? (
            <p className="tool-submit-notice tool-submit-notice-error">
              最近一次生成失败：{taskErrorText(result.errorCode)}
            </p>
          ) : null
        }
        pending={submitting ? [{ key: 'pending' }] : []}
        emptyTitle="效果图预览"
        emptyDesc={
          token
            ? '提交任务后，生成结果将在此处展示，本页生成过的图片都会保留在这里'
            : '登录后，你在这个页面生成过的图片都会显示在这里'
        }
        onRefresh={() => void gallery.reload()}
        onDelete={deleteImage}
        extraActions={(item) => [
          {
            key: 'reference',
            label: '用作参考图',
            icon: ImagePlus,
            onSelect: () => useAsReference(item),
          },
        ]}
        downloadNamePrefix="free-create"
      />

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
