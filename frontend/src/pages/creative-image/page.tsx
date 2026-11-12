import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  CREATION_CAPABILITY_LABELS,
  CREATION_DOWNLOAD_PREFIX,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_REF_IMAGES,
  SUPPORTED_IMAGE_LABEL,
  type CreationCapability,
} from './constants';
import {
  AssetLibraryModal,
  ImageToPromptModal,
  MobileUploadModal,
  PromptPolishModal,
  type ToolAsset,
} from './components';
import {
  notifyCreditsChanged,
  useAssetLibrary,
  useAuth,
  useCapabilityRuntime,
  useCreditLabel,
  useGenerateError,
  usePasteUpload,
  usePollAbort,
  useProject,
  useResultGallery,
  type GalleryItem,
} from './hooks';
import { assetsApi, assetSrc, generateApi, newIdempotencyKey, resolveModelId, toAbsoluteUrl } from './api';
import { isSupportedImageFile, pollToResult, resolveCreationCapability, taskErrorText } from './utils';
import { CreativeImageInputPane } from './CreativeImageInputPane';
import { CreativeImageOutputPane } from './CreativeImageOutputPane';
import { CreativeImagePromptModal } from './CreativeImagePromptModal';
import type { Asset, MobileUploadAsset } from '../../types/api';
import { useApp } from '../../ui';

/**
 * 创意生图 / 自由创作工作台
 * `/creative-image` → creative_image，`/free-creation` → free_create。
 *
 * 结果栏展示「全部生成图」: 本页能力 (creative_image / free_create) 全部成功产出的网格,
 * 数据取自 /tasks。
 * 新图由轮询结果**当场插入榜首** (不重拉列表, 避免占位撤下后旧图回弹的闪烁);
 * 点缩略图开大图预览 (原始比例 + 下载原图)。
 *
 * 接线: 参考图 (0~4 张, 顺序保留) + 提示词 → 当前能力的任务 (参考图为选填,
 * 后端 inputs=0 不强制张数); 比例/画质 → ratio / size 参数; 张数与顺序直达 provider
 * (顶部条带横排参考图, 真实参与构图)。
 *
 * 产出来源不向用户展示: 创作统一走 API 调用模型, 新任务只来自真实模型线路。
 *
 * 没通道就失败: 两种能力都只允许模型生成。后端无可用模型通道时任务按 42204 失败并退款;
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
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：输入栏 `CreativeImageInputPane`
 * （上传 `CreativeImageUploadSection` / 缩略图 `CreativeImageReferenceThumb` /
 * 提交 `CreativeImageSubmitBar`）、结果栏 `CreativeImageOutputPane`、
 * 提示词放大 `CreativeImagePromptModal`。状态与写操作只留在本文件。
 */

export function CreativeImagePage({ capability: capabilityProp }: { capability?: CreationCapability } = {}) {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token, openLogin } = useAuth();
  const [searchParams] = useSearchParams();
  // 独立路由 `/creative-image` 直接带能力; 保留的 `/free-creation` 走查询参数,
  // 未知参数回落到自由创作, 避免把任意串透传给后端。
  const capability = capabilityProp ?? resolveCreationCapability(searchParams.get('capability'));
  const capabilityLabel = CREATION_CAPABILITY_LABELS[capability];
  /**
   * 建单幂等键。请求超时/连接重置但服务端已落单时，用户重试必须复用同一个 key，
   * 否则同一个提示词会生成两次、扣两次费；拿到 taskId 后清空。
   */
  const pendingStartRef = useRef<{ fingerprint: string; key: string } | null>(null);
  // 消耗价优先用所选模型实时报价，取不到才回落到能力基础价
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);
  const baseCreditLabel = useCreditLabel(capability);
  const creditLabel =
    modelQuoteCredits == null
      ? baseCreditLabel
      : modelQuoteCredits === 0
        ? '免费'
        : `本次约 ${modelQuoteCredits} 积分（按所选模型）`;

  // ── 表单状态 ──
  const [images, setImages] = useState<ToolAsset[]>([]);
  /**
   * 参考图位的同步镜像。
   *
   * 素材库「确定」是同步 for 循环逐个调 onPick, 期间不重渲染 —— 只读 state
   * 会让一次勾选超过剩余位数的图全部进列表 (每张都读到同一份旧值)。
   */
  const imagesRef = useRef<ToolAsset[]>(images);
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
  /** 最近一次生成失败的用户可读文案；成功提交时清空 */
  const [failureNotice, setFailureNotice] = useState<string | null>(null);
  const pollSignal = usePollAbort();

  // ── 右侧「全部生成图」(本页能力的历史产出) ──
  // 数据取自 /tasks 而非 /assets: 生成记录以任务为准 (创作时间、尺寸口径都在任务上)。
  const gallery = useResultGallery({ capability, token });
  // 服务端仍有 running/pending 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢
  const generating = submitting || gallery.items.some((item) => !item.url);

  // 参考站该页: 参考图选填 (标题无必填星号), 提示词必填 (label ::before 星)
  const formValid = prompt.trim().length > 0;

  /*
   * 只在后端明确报 unavailable/disabled 时拦截；清单加载中或加载失败不拦，
   * 避免一次网络抖动就让整页不可用。
   */
  const { blocked: capabilityBlocked, reason: unavailableReason } = useCapabilityRuntime(capability);

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
      const oversize = accepted.filter((file) => file.size > MAX_IMAGE_BYTES);
      if (oversize.length > 0) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((file) => file.name).join('、')}`);
        return;
      }

      setUploading(true);
      try {
        const projectId = await ensureProject();
        const uploaded: ToolAsset[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        }
        setImages((prev) => [...prev, ...uploaded]);
        message.success(`已上传 ${uploaded.length} 张参考图片`);
      } catch (error) {
        message.error((error as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [images.length, ensureProject, message],
  );

  const removeImage = (id: string) => setImages((prev) => prev.filter((item) => item.id !== id));

  /** 调整参考图顺序 (参考站缩略图左右箭头; 边界禁用) */
  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // 拖拽 & 粘贴 (本页唯一上传区即参考图区, 粘贴直接进参考图)
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
    if (current.some((item) => item.id === asset.id)) {
      message.info('该素材已在列表中');
      return false;
    }
    const next: ToolAsset = {
      id: asset.id,
      url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
      name: asset.sourceUrl.split('/').pop() ?? '素材',
    };
    imagesRef.current = [...current, next];
    setImages((prev) => (prev.some((item) => item.id === next.id) ? prev : [...prev, next]));
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
        const fresh = assets.filter((asset) => !prev.some((item) => item.id === asset.id));
        const accepted = fresh.slice(0, room);
        const dropped = fresh.length - accepted.length;
        if (dropped > 0) {
          message.warning(`参考图位只剩 ${room} 个, ${dropped} 张未加入`);
        }
        return [
          ...prev,
          ...accepted.map((asset) => ({
            id: asset.id,
            url: toAbsoluteUrl(asset.signedUrl || asset.url) ?? '',
            name: asset.filename,
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
  // 「查看大图 / 复制地址 / 下载 / 删除」由结果栏组件提供, 本页只补
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
    if (images.some((image) => image.id === assetId)) {
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
          if (item.assetId) setImages((prev) => prev.filter((image) => image.id !== item.assetId));
          message.success('已删除作品及其生成图');
        } catch (error) {
          message.error((error as Error).message || '删除失败');
        }
      },
    });
  };

  // ── 生成 ──
  const pollTask = useCallback((taskId: string) => pollToResult(taskId, { signal: pollSignal }), [pollSignal]);

  const submit = async () => {
    if (!formValid || generating) return;
    // 没有可用模型通道: 后端必定 42204 并退款, 不发起这次注定失败的任务
    if (unavailableReason) {
      message.warning(unavailableReason);
      return;
    }
    setSubmitting(true);
    setFailureNotice(null);
    try {
      const projectId = await ensureProject();
      const logicalModelId = await resolveModelId(capability);
      const payload = {
        projectId,
        capability,
        logicalModelId,
        // 参考图选填 0~4 张; 顺序即构图顺序 (provider 顶部条带按序横排)
        inputAssetIds: images.map((image) => image.id),
        params: {
          prompt: prompt.trim(),
          ratio,
          size: resolution,
        },
      };
      const fingerprint = JSON.stringify(payload);
      const idempotencyKey =
        pendingStartRef.current?.fingerprint === fingerprint ? pendingStartRef.current.key : newIdempotencyKey();
      pendingStartRef.current = { fingerprint, key: idempotencyKey };
      const { taskId } = await generateApi.start({ ...payload, idempotencyKey });
      pendingStartRef.current = null;
      const done = await pollTask(taskId);
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
            assetId: done.assetId,
            format: done.format,
            width: done.width ?? null,
            height: done.height ?? null,
            createdAt: new Date().toISOString(),
            prompt: prompt.trim(),
          },
        ]);
      } else if (done.status === 'failed') {
        const notice = taskErrorText(done.errorCode);
        message.error(`生成失败：${notice}`);
        setFailureNotice(notice);
      } else {
        message.success('创作图已生成');
      }
    } catch (error) {
      reportError(error);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  /*
   * 不可用的置灰**只对已登录生效**: guest 点按钮的职责是弹登录框
   * (见 free-creation-submit.spec.ts 的登录墙契约), 置灰会把它挡掉。
   * 已登录时置灰 + 上方说明, 避免发起一次注定 42204 的请求。
   */
  const submitDisabled = !formValid || (Boolean(token) && capabilityBlocked);

  return (
    <div className="pk-workspace fc-workspace">
      <CreativeImageInputPane
        capability={capability}
        capabilityLabel={capabilityLabel}
        images={images}
        uploading={uploading}
        onUploadFiles={uploadFiles}
        onRemoveImage={removeImage}
        onMoveImage={moveImage}
        onOpenLibrary={openLibrary}
        onOpenMobile={runMobileUpload}
        prompt={prompt}
        onPromptChange={setPrompt}
        onPolish={runPolish}
        onImageToPrompt={runImageToPrompt}
        onExpandPrompt={() => setExpandOpen(true)}
        generating={generating}
        submitDisabled={submitDisabled}
        creditLabel={creditLabel}
        unavailableReason={unavailableReason}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        ratio={ratio}
        onRatioChange={setRatio}
        resolution={resolution}
        onResolutionChange={setResolution}
        onModelQuoteChange={setModelQuoteCredits}
        onSubmit={() => void submit()}
      />

      <CreativeImageOutputPane
        generating={generating}
        submitting={submitting}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        failureNotice={failureNotice}
        loggedIn={Boolean(token)}
        onRefresh={() => void gallery.reload()}
        onDelete={deleteImage}
        onUseAsReference={useAsReference}
        downloadNamePrefix={CREATION_DOWNLOAD_PREFIX[capability]}
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

      <CreativeImagePromptModal
        open={expandOpen}
        value={prompt}
        onChange={setPrompt}
        onClose={() => setExpandOpen(false)}
      />
    </div>
  );
}
