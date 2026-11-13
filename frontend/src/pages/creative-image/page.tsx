import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  CREATION_CAPABILITY_LABELS,
  CREATION_DOWNLOAD_PREFIX,
  CREATION_PROMPT_PLACEHOLDER,
  MAX_IMAGE_MB,
  MAX_PROMPT_LEN,
  MAX_REF_IMAGES,
  type CreationCapability,
} from './constants';
import {
  AssetLibraryModal,
  ExpandTextModal,
  ImageToPromptModal,
  MobileUploadModal,
  PromptPolishModal,
} from './components';
import {
  hasActiveGalleryItems,
  notifyCreditsChanged,
  useAuth,
  useCapabilityRuntime,
  useDeleteGalleryItem,
  useGenerateError,
  useIdempotencyKey,
  useImageUpload,
  useModelQuoteCreditLabel,
  usePollAbort,
  useProject,
  useResultGallery,
  type GalleryItem,
} from './hooks';
import { generateApi, resolveModelKey } from './api';
import { pollToResult, resolveCreationCapability, taskErrorText } from './utils';
import { CreativeImageInputPane } from './CreativeImageInputPane';
import { CreativeImageOutputPane } from './CreativeImageOutputPane';
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
 * （上传 `CreativeImageUploadSection` / 缩略图 `CreativeImageReferenceThumb`）、
 * 结果栏 `CreativeImageOutputPane`。上传 / 素材库 / 手机回填 / 排序统一走共享
 * `useImageUpload`；提示词放大走共享 `ExpandTextModal`。状态与写操作只留在本文件。
 */

export function CreativeImagePage({ capability: capabilityProp }: { capability?: CreationCapability } = {}) {
  const { message } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token, openLogin } = useAuth();
  const [searchParams] = useSearchParams();
  // 独立路由 `/creative-image` 直接带能力; 保留的 `/free-creation` 走查询参数,
  // 未知参数回落到自由创作，避免把任意串透传给后端。
  const capability = capabilityProp ?? resolveCreationCapability(searchParams.get('capability'));
  const capabilityLabel = CREATION_CAPABILITY_LABELS[capability];
  // 同一次提交的网络重试复用同一个 key，避免重复建单扣费
  const { keyFor: idempotencyKeyFor, reset: resetIdempotencyKey } = useIdempotencyKey();
  // 消耗价优先用所选模型实时报价，取不到才回落到能力基础价
  const { label: creditLabel, onModelQuoteChange } = useModelQuoteCreditLabel({ capability });

  // ── 表单状态 ──
  // 上传 (三重校验 / 素材库回填 / 粘贴 / 排序) 统一由 useImageUpload 处理
  const { images, uploading, uploadFiles, removeImage, moveImage, replaceImages, library, mobile } =
    useImageUpload({ max: MAX_REF_IMAGES, maxMb: MAX_IMAGE_MB, noun: '参考图片' });
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);
  const [polishOpen, setPolishOpen] = useState(false);
  const [i2pOpen, setI2pOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  /** 最近一次生成失败的用户可读文案；成功提交时清空 */
  const [failureNotice, setFailureNotice] = useState<string | null>(null);
  const pollSignal = usePollAbort();

  // ── 右侧「全部生成图」(本页能力的历史产出) ──
  // 数据取自 /tasks 而非 /assets: 生成记录以任务为准 (创作时间、尺寸口径都在任务上)。
  const gallery = useResultGallery({ capability, token });
  // 服务端仍有 queued/running 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢
  const generating = submitting || hasActiveGalleryItems(gallery.items);

  // 参考站该页: 参考图选填 (标题无必填星号), 提示词必填 (label ::before 星)
  const formValid = prompt.trim().length > 0;

  /*
   * 只在后端明确报 unavailable/disabled 时拦截；清单加载中或加载失败不拦，
   * 避免一次网络抖动就让整页不可用。
   */
  const { blocked: capabilityBlocked, reason: unavailableReason } = useCapabilityRuntime(capability);

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
    mobile.openMobile();
  };

  // ── 结果图操作 ──
  //
  // 「查看大图 / 复制地址 / 下载 / 删除」由结果栏组件提供, 本页只补
  // 本页独有的「用作参考图」与删除时的连带清理。

  /** 把这张生成图放进左侧参考图位 */
  const useAsReference = useCallback(
    (item: GalleryItem) => {
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
      replaceImages([...images, { id: assetId, url: item.url, name: `生成图-${item.id.slice(-6)}` }]);
      message.success('已加入参考图位，下一轮生成会带上它');
    },
    [images, message, replaceImages],
  );

  /**
   * 删除作品 —— 产出素材若正占着参考图位，必须同步摘掉；
   * 否则下一次生成会带着一个已不存在的 assetId 提交。
   */
  const deleteImage = useDeleteGalleryItem({
    removeItem: gallery.removeItem,
    onDeleted: (item) => {
      if (item.assetId) removeImage(item.assetId);
    },
  });

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
      const modelKey = await resolveModelKey(capability);
      const payload = {
        projectId,
        capability,
        modelKey,
        // 参考图选填 0~4 张; 顺序即构图顺序 (provider 顶部条带按序横排)
        inputAssetIds: images.map((image) => image.id),
        params: {
          prompt: prompt.trim(),
          ratio,
          size: resolution,
        },
      };
      const idempotencyKey = idempotencyKeyFor(JSON.stringify(payload));
      const { taskId } = await generateApi.start({ ...payload, idempotencyKey });
      resetIdempotencyKey();
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
        onOpenLibrary={library.openLibrary}
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
        onModelQuoteChange={onModelQuoteChange}
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
        open={library.open}
        loading={library.loading}
        items={library.items}
        error={library.error}
        onCancel={library.closeLibrary}
        onPick={library.pick}
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
      <MobileUploadModal open={mobile.open} onReceived={mobile.addAssets} onCancel={mobile.closeMobile} />

      <ExpandTextModal
        open={expandOpen}
        title="编辑创作提示词"
        value={prompt}
        maxLength={MAX_PROMPT_LEN}
        placeholder={CREATION_PROMPT_PLACEHOLDER}
        onChange={setPrompt}
        onClose={() => setExpandOpen(false)}
      />
    </div>
  );
}
