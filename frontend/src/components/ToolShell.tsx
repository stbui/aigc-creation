import '../styles/redraw.css';
import { useMemo, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useCapabilityRuntime, useCreditLabel } from '../hooks';
import { useAuth } from '../context/AuthContext';
import { AssetLibraryModal } from './AssetLibraryModal';
import { MobileUploadModal } from './MobileUploadModal';
import { ToolSettingsPopover } from './ToolSettingsPopover';
import { ModelPicker } from './ModelPicker';
import { ToolSubmitBar } from './ToolSubmitBar';
import { ImageLightbox } from './ImageLightbox';
import { ToolUploadCard } from './ToolUploadCard';
import { ToolResultPane } from './ToolResultPane';
import { useToolUploadSlots } from '../hooks/useToolUploadSlots';
import { useApp } from '../ui';
import { ToolTrailingContext } from './toolShellTypes';
import type { Props, ToolAsset, ToolResult, ToolTrailingControl } from './toolShellTypes';

/**
 * 修图系工具页共享骨架 —— 1:1 复刻参考站 local-redraw / background-remove 等页的公共结构:
 *   左栏 432px: 上传卡 (* 上传图片 + 从素材库导入 + 手机上传 + dropzone)
 *              → 业务卡 (children, 各页自定义)
 *              → 提交区 (高级设置 popover + 主按钮, sticky 底部)
 *              → 历史记录 (可折叠, 真实任务数据)
 *   右栏: 结果预览 (空态插画 + 说明 / 生成结果 + 重新生成)
 * 上传/设置/提交/结果的视觉与 pk-* (product-kit) 完全同源, 业务差异由 children 与配置注入。
 *
 * 2026-11-14 按单一职责拆分（对外 API 与 DOM 一行未改）：
 * `useToolUploadSlots`（图片位状态与写操作）/ `ToolUploadCard`（上传卡）/
 * `ToolResultPane`（结果三态）；本文件只负责组合、设置项与提交。
 */

export function ToolShell(props: Props) {
  /**
   * 自动消耗价。capability 已由本组件持有, 无需各页再传一遍 ——
   * 让「价格跟着能力走」而不是「跟着页面记忆走」。
   */
  const autoCreditLabel = useCreditLabel(props.capability);

  /*
   * 该项能力此刻能不能提交 (2026-10-21)。
   *
   * 后端对「本地没有实现」的能力 (局部重绘 / 图片翻译 / 自由创作)
   * 是 **没通道就判失败并退款**, 不存在本地产出。故这些页在按钮上方如实说明,
   * 并把提交置灰 —— 否则用户点下去只会等到一次 42204。
   * 2026-10-25 起所有图像能力都必须有模型通道，unavailable 一律拦截。
   */
  const { blocked: capabilityBlocked, reason: unavailableReason } = useCapabilityRuntime(props.capability);
  const { token } = useAuth();
  /*
   * 只拦**已登录**用户的提交。访客点击仍要走登录弹窗（上传/提交接口的
   * 401 → auth:required 契约）；把按钮对访客一起置灰，会让他在登录前
   * 连「为什么不能用」的入口都点不到。
   */
  const blocked = Boolean(token) && capabilityBlocked;
  const {
    capability,
    pageClass,
    title,
    desc,
    upload,
    requiredInputs = [],
    settings,
    submitLabel,
    creditLabel,
    hint,
    emptyDesc,
    children,
    renderUploadPreview,
    replaceUpload = false,
    onImagesChange,
    formValid,
    submitting,
    result,
    resultTag,
    onSubmit,
    onSettingsChange,
    resultActions,
    resultCompare,
    resultView = 'default',
    generatingAspect,
    resultBadge,
    onHistoryReuse,
    resultPane,
    sourcePane,
    keepSourceWhileSubmitting = false,
    emptyVideo,
    trailingPane,
  } = props;

  const { message } = useApp();

  const {
    allowedAccept,
    images,
    uploading,
    mobileOpen,
    setMobileOpen,
    library,
    pickFromLibrary,
    uploadFiles,
    removeImage,
    addMobileAssets,
    reuseHistoryTask,
  } = useToolUploadSlots({ upload, replaceUpload, onImagesChange, onHistoryReuse });

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [trailingCollapsed, setTrailingCollapsed] = useState(false);
  const [ratio, setRatio] = useState(settings?.defaultRatio ?? 'original');
  const [resolution, setResolution] = useState(settings?.defaultResolution ?? '1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** 必填图片位是否已满足；各页无需重复判断，避免出现“空图也能提交”。 */
  const uploadSatisfied = !upload?.required || images.length >= 1;
  /** 上传中同样阻止提交，防止遮罩/参数基于半完成素材生成。 */
  const canSubmit = formValid && uploadSatisfied && !uploading;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    // 能力不可提交 (未接通道 / 已下线): 不发这次注定 42204 的请求
    if (blocked) {
      message.warning(unavailableReason || '该能力当前不可提交');
      return;
    }
    await onSubmit(images, { ratio, resolution });
  };

  /** 结果归一化：单条 / 多条 / 空 都收成数组，供三态判断与灯箱共用。 */
  const results = useMemo<ToolResult[]>(
    () => (result === null ? [] : Array.isArray(result) ? result : [result]),
    [result],
  );

  /** 灯箱只收「已成功且是图片」的产出，视频与失败态不参与左右切换。 */
  const lightboxItems = useMemo(
    () =>
      results
        .filter((item) => item.status === 'succeeded' && item.url && item.modality !== 'video')
        .map((item) => ({
          id: item.url!,
          url: item.url!,
          width: item.width,
          height: item.height,
        })),
    [results],
  );
  const lightboxIndex = lightboxUrl ? lightboxItems.findIndex((item) => item.url === lightboxUrl) : -1;

  /**
   * 附加栏控制值。
   *
   * 稳定引用：`trailingPane` 是页面传进来的节点，`ToolHistoryPane` 消费这个
   * context；此前每次 ToolShell 重渲染（上传进度、拖拽高亮）都会新建 value，
   * 让整条历史列表跟着重渲。折叠态或复用函数变化时才更新。
   */
  const trailingControl = useMemo<ToolTrailingControl | null>(
    () =>
      trailingPane
        ? {
            collapsed: trailingCollapsed,
            toggle: () => setTrailingCollapsed((value) => !value),
            reuseTask: reuseHistoryTask,
          }
        : null,
    [reuseHistoryTask, trailingCollapsed, trailingPane],
  );

  return (
    <div
      className={`pk-workspace${pageClass ? ` ${pageClass}` : ''}${trailingPane ? ' pk-workspace-trailing' : ''}${
        trailingPane && trailingCollapsed ? ' pk-workspace-trailing-collapsed' : ''
      }`}
    >
      {/* ── 左: 输入栏 ── */}
      <aside className="pk-input-pane">
        <div className="pk-form-card">
          <div className="pk-form-scroll">
            {/* 上传卡 (页面自带上传区时跳过) */}
            {upload && (
              <ToolUploadCard
                upload={upload}
                images={images}
                uploading={uploading}
                allowedAccept={allowedAccept}
                renderUploadPreview={renderUploadPreview}
                onFiles={(files) => void uploadFiles(files)}
                onOpenLibrary={library.openLibrary}
                onOpenMobile={() => setMobileOpen(true)}
                onRemove={removeImage}
                onPreview={(image: ToolAsset) => setLightboxUrl(image.url)}
              />
            )}

            {/* 业务卡 (函数形态可读到已上传图片, 供画布类页面当底图) */}
            {typeof children === 'function' ? children(images) : children}
          </div>

          {/* 提交区 (sticky 底部) */}
          {/*
            能力不可提交时先说明再置灰 (2026-10-21)。
            所有图像能力都只走模型。没有可用通道时后端会 failed/42204，
            与其让用户点下去等一次失败，不如在这里说清原因并禁用提交。
          */}
          {blocked && unavailableReason && !submitting && (
            <p className="tool-submit-notice tool-submit-notice-error">{unavailableReason}</p>
          )}
          <ToolSubmitBar
            submitting={submitting}
            disabled={!canSubmit || blocked}
            label={submitLabel}
            creditLabel={creditLabel ?? autoCreditLabel ?? undefined}
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
                  modelPicker={
                    <ModelPicker
                      capability={capability}
                      requiredInputs={requiredInputs}
                      options={{ ratio, resolution }}
                    />
                  }
                />
              ) : null
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 (页面可注入共享结果网格) ── */}
      {resultPane ?? (
        <ToolResultPane
          title={title}
          desc={desc}
          emptyDesc={emptyDesc}
          capability={capability}
          submitting={submitting}
          results={results}
          images={images}
          resultView={resultView}
          generatingAspect={generatingAspect}
          resultTag={resultTag}
          resultBadge={resultBadge}
          resultActions={resultActions}
          resultCompare={resultCompare}
          sourcePane={sourcePane}
          keepSourceWhileSubmitting={keepSourceWhileSubmitting}
          emptyVideo={emptyVideo}
          onPreview={setLightboxUrl}
          onRegenerate={() => void submit()}
        />
      )}

      {/* ── 右: 附加栏 (局部重绘历史记录; 其他页面不传则为空) ── */}
      {trailingPane && trailingControl && (
        <ToolTrailingContext.Provider value={trailingControl}>{trailingPane}</ToolTrailingContext.Provider>
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
        open={library.open}
        loading={library.loading}
        items={library.items}
        error={library.error}
        onCancel={library.closeLibrary}
        onPick={pickFromLibrary}
        maxSelectable={
          upload
            ? replaceUpload && upload.max === 1 && images.length > 0
              ? 1
              : Math.max(upload.max - images.length, 0)
            : undefined
        }
      />

      {/* 手机上传弹窗 (二维码方案) */}
      <MobileUploadModal open={mobileOpen} onReceived={addMobileAssets} onCancel={() => setMobileOpen(false)} />
    </div>
  );
}

/**
 * 对外导出面。
 *
 * 与拆分前逐一对齐，9 个工具页、`ToolHistoryPane` 与 `MattingResultEditor` 的
 * `from '../components/ToolShell'` 导入无需改动。实现分别落在：
 * `toolShellTypes.ts`（契约）/ `ToolResultCards.tsx`（产品卡）/
 * `ExpandTextModal.tsx`（放大编辑）/ `hooks/useTaskPoller.ts`（轮询）/
 * `hooks/useToolUploadSlots.ts`（图片位）/ `ToolUploadCard.tsx`（上传卡）/
 * `ToolResultPane.tsx`（结果三态）。
 */
export type {
  Props,
  SettingsSpec,
  ToolAsset,
  ToolResult,
  ToolResultCompare,
  ToolSettings,
  ToolTrailingControl,
  UploadPreviewControls,
  UploadSpec,
} from './toolShellTypes';
export { ToolTrailingContext };

/** 空态插画: 与 pk/vc/fc 同一张内联 SVG (不使用参考站图片资源) */
export { ToolEmptyIllustration } from './illustrations';

export { useTaskPoller } from '../hooks/useTaskPoller';

export { ExpandTextModal } from './ExpandTextModal';

export { Maximize2 };
